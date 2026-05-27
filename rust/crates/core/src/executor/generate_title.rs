use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use tokio::process::Command;

use crate::executor::fresh_env::get_fresh_env;

const TITLE_MODEL: &str = "claude-haiku-4-5-20251001";

static QUOTE_PAT: OnceLock<Regex> = OnceLock::new();
static SUSPICIOUS_PAT: OnceLock<Regex> = OnceLock::new();

fn quote_pat() -> &'static Regex {
    QUOTE_PAT.get_or_init(|| Regex::new(r#"^["']|["']$"#).unwrap())
}

fn suspicious_pat() -> &'static Regex {
    SUSPICIOUS_PAT.get_or_init(|| Regex::new(r"(?i)reached max turns|error:").unwrap())
}

fn post_process_title(output: &str) -> String {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let title = quote_pat().replace_all(trimmed, "");
    let title = title.chars().take(200).collect::<String>();

    if suspicious_pat().is_match(&title) {
        return String::new();
    }

    title
}

/// Async generates a short title from a card description via `claude` CLI.
/// Returns empty string on any failure.
pub async fn generate_title(description: &str) -> String {
    if description.is_empty() {
        return String::new();
    }

    let truncated = description
        .char_indices()
        .nth(1000)
        .map_or(description, |(i, _)| &description[..i]);

    let prompt = format!(
        "Generate a very short title (2-5 words) for this task. Reply with ONLY the title text, no quotes, no explanation, no punctuation at the end.\n\n{}",
        truncated
    );

    let env: HashMap<String, String> = get_fresh_env();

    let output = match Command::new("claude")
        .args([
            "-p",
            &prompt,
            "--output-format",
            "text",
            "--max-turns",
            "2",
            "--model",
            TITLE_MODEL,
        ])
        .env_clear()
        .envs(&env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return String::new(),
    };

    if !output.status.success() {
        return String::new();
    }

    let stdout = match String::from_utf8(output.stdout) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };

    post_process_title(&stdout)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_process_strips_leading_double_quote() {
        assert_eq!(post_process_title("\"hello"), "hello");
    }

    #[test]
    fn post_process_strips_trailing_double_quote() {
        assert_eq!(post_process_title("hello\""), "hello");
    }

    #[test]
    fn post_process_strips_both_double_quotes() {
        assert_eq!(post_process_title("\"hello\""), "hello");
    }

    #[test]
    fn post_process_strips_single_quotes() {
        assert_eq!(post_process_title("'hello'"), "hello");
    }

    #[test]
    fn post_process_caps_at_200_chars() {
        let input: String = "a".repeat(300);
        let result = post_process_title(&input);
        assert_eq!(result.chars().count(), 200);
    }

    #[test]
    fn post_process_rejects_max_turns() {
        assert_eq!(post_process_title("reached max turns"), "");
    }

    #[test]
    fn post_process_rejects_error_prefix() {
        assert_eq!(post_process_title("error: blah"), "");
    }

    #[test]
    fn post_process_normal_title() {
        assert_eq!(post_process_title("Add login flow"), "Add login flow");
    }

    #[tokio::test]
    async fn generate_title_empty_description_returns_empty() {
        assert_eq!(generate_title("").await, "");
    }
}
