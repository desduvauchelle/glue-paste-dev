use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum StreamEventKind {
    Text,
    ToolUse,
    Result,
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedStreamEvent {
    pub kind: StreamEventKind,
    pub content: String,
    pub cost_usd: Option<f64>,
    pub session_id: Option<String>,
    pub is_error: Option<bool>,
}

pub fn parse_stream_line(line: &str) -> Option<ParsedStreamEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => {
            return Some(ParsedStreamEvent {
                kind: StreamEventKind::Text,
                content: trimmed.to_string(),
                cost_usd: None,
                session_id: None,
                is_error: None,
            });
        }
    };

    match parsed["type"].as_str() {
        Some("assistant") => {
            if let Some(content_arr) = parsed["message"]["content"].as_array() {
                // Try text parts first
                let text_parts: String = content_arr
                    .iter()
                    .filter(|c| c["type"].as_str() == Some("text"))
                    .map(|c| c["text"].as_str().unwrap_or(""))
                    .collect();

                if !text_parts.is_empty() {
                    return Some(ParsedStreamEvent {
                        kind: StreamEventKind::Text,
                        content: text_parts,
                        cost_usd: None,
                        session_id: None,
                        is_error: None,
                    });
                }

                // Fall back to tool_use parts
                let tool_parts: Vec<String> = content_arr
                    .iter()
                    .filter(|c| c["type"].as_str() == Some("tool_use"))
                    .map(|c| {
                        let name = c["name"].as_str().unwrap_or("unknown");

                        if name == "Write" && c["input"]["content"].as_str().is_some() {
                            let file_path =
                                c["input"]["file_path"].as_str().unwrap_or("unknown file");
                            let content = c["input"]["content"].as_str().unwrap_or("");
                            return format!("[Tool: Write to {file_path}]\n{content}");
                        }

                        if name == "Edit" && c["input"]["new_string"].as_str().is_some() {
                            let file_path =
                                c["input"]["file_path"].as_str().unwrap_or("unknown file");
                            let new_string = c["input"]["new_string"].as_str().unwrap_or("");
                            return format!(
                                "[Tool: Edit {file_path}]\nNew content:\n{new_string}"
                            );
                        }

                        format!("[Tool: {name}]")
                    })
                    .collect();

                let joined = tool_parts.join("\n");
                if !joined.is_empty() {
                    return Some(ParsedStreamEvent {
                        kind: StreamEventKind::ToolUse,
                        content: joined,
                        cost_usd: None,
                        session_id: None,
                        is_error: None,
                    });
                }
            }

            // assistant event with no usable content — fall through to unknown
            Some(ParsedStreamEvent {
                kind: StreamEventKind::Unknown,
                content: trimmed.to_string(),
                cost_usd: None,
                session_id: None,
                is_error: None,
            })
        }

        Some("result") => {
            let content = parsed["result"].as_str().unwrap_or("").to_string();
            let cost_usd = parsed["cost_usd"].as_f64();
            let session_id = parsed["session_id"].as_str().map(|s| s.to_string());
            let is_error = parsed["is_error"].as_bool();

            Some(ParsedStreamEvent {
                kind: StreamEventKind::Result,
                content,
                cost_usd,
                session_id,
                is_error,
            })
        }

        _ => Some(ParsedStreamEvent {
            kind: StreamEventKind::Unknown,
            content: trimmed.to_string(),
            cost_usd: None,
            session_id: None,
            is_error: None,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn line(v: serde_json::Value) -> String {
        v.to_string()
    }

    #[test]
    fn parses_text_content_blocks() {
        let input = line(json!({
            "type": "assistant",
            "message": {
                "content": [{"type": "text", "text": "Hello world"}]
            }
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::Text);
        assert_eq!(result.content, "Hello world");
    }

    #[test]
    fn parses_regular_tool_use_as_tool_name() {
        let input = line(json!({
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_use", "name": "Read"}]
            }
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::ToolUse);
        assert_eq!(result.content, "[Tool: Read]");
    }

    #[test]
    fn extracts_content_from_write_tool_use() {
        let input = line(json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Write",
                    "input": {
                        "file_path": "/tmp/foo.txt",
                        "content": "file contents here"
                    }
                }]
            }
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::ToolUse);
        assert!(result.content.contains("/tmp/foo.txt"));
        assert!(result.content.contains("file contents here"));
    }

    #[test]
    fn extracts_new_string_from_edit_tool_use() {
        let input = line(json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Edit",
                    "input": {
                        "file_path": "/tmp/bar.txt",
                        "new_string": "updated content"
                    }
                }]
            }
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::ToolUse);
        assert!(result.content.contains("/tmp/bar.txt"));
        assert!(result.content.contains("updated content"));
    }

    #[test]
    fn falls_back_to_tool_write_when_content_missing() {
        let input = line(json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "name": "Write",
                    "input": {}
                }]
            }
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::ToolUse);
        assert_eq!(result.content, "[Tool: Write]");
    }

    #[test]
    fn parses_result_events_with_cost() {
        let input = line(json!({
            "type": "result",
            "result": "done",
            "cost_usd": 0.05,
            "session_id": "abc"
        }));
        let result = parse_stream_line(&input).expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::Result);
        assert_eq!(result.content, "done");
        assert_eq!(result.cost_usd, Some(0.05));
        assert_eq!(result.session_id, Some("abc".to_string()));
    }

    #[test]
    fn returns_none_for_empty_lines() {
        assert!(parse_stream_line("").is_none());
        assert!(parse_stream_line("   ").is_none());
    }

    #[test]
    fn treats_non_json_lines_as_raw_text() {
        let result = parse_stream_line("some raw output").expect("should return Some");
        assert_eq!(result.kind, StreamEventKind::Text);
        assert_eq!(result.content, "some raw output");
    }
}
