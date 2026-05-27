use std::collections::HashMap;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::executor::fresh_env::get_fresh_env;

const EXTRACT_MODEL: &str = "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PlanSummary {
    #[serde(default)]
    pub key_files: Vec<String>,
    #[serde(default)]
    pub risks: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PlanReport {
    #[serde(default)]
    pub criteria: Vec<String>,
    pub plan_summary: PlanSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CriterionResult {
    pub id: String,
    pub status: String,
    #[serde(default)]
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Blocker {
    #[serde(rename = "type")]
    pub kind: String,
    pub root_cause: String,
    pub resolution_route: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ExecuteReport {
    #[serde(default)]
    pub criteria: Vec<CriterionResult>,
    #[serde(default)]
    pub completion_summary: String,
    #[serde(default)]
    pub blocker: Option<Blocker>,
}

// ---------------------------------------------------------------------------
// Argument types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PlanReportArgs {
    pub title: String,
    pub description: String,
    pub plan_output: String,
}

#[derive(Debug, Clone)]
pub struct FileChange {
    pub path: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Debug, Clone)]
pub struct CriterionInput {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct ExecuteReportArgs {
    pub title: String,
    pub description: String,
    pub criteria: Vec<CriterionInput>,
    pub output: String,
    pub files_changed: Vec<FileChange>,
    pub exit_code: i32,
}

// ---------------------------------------------------------------------------
// parse_report_json
// ---------------------------------------------------------------------------

/// Try parsing text as a fenced ```json block first, then as content between first { and last }.
/// Returns None if neither candidate parses to the target type.
pub fn parse_report_json<T: serde::de::DeserializeOwned>(text: &str) -> Option<T> {
    let mut candidates: Vec<String> = Vec::new();

    // First candidate: fenced ```json...``` or ```...``` block
    // Use (?s) dot-all flag + lazy quantifier to replicate [\s\S]*?
    if let Ok(re) = Regex::new(r"(?s)```(?:json)?\s*(.*?)```") {
        if let Some(cap) = re.captures(text) {
            if let Some(m) = cap.get(1) {
                candidates.push(m.as_str().trim().to_string());
            }
        }
    }

    // Second candidate: content between first '{' and last '}'
    if let (Some(first), Some(last)) = (text.find('{'), text.rfind('}')) {
        if last > first {
            candidates.push(text[first..=last].to_string());
        }
    }

    for candidate in &candidates {
        if let Ok(parsed) = serde_json::from_str::<T>(candidate) {
            return Some(parsed);
        }
    }

    None
}

// ---------------------------------------------------------------------------
// write_report_file
// ---------------------------------------------------------------------------

/// Writes JSON to <directory>/.glue-paste/reports/<execution_id>.json. Swallows errors.
pub fn write_report_file<T: serde::Serialize>(directory: &str, execution_id: &str, data: &T) {
    let _ = (|| -> std::io::Result<()> {
        let dir = std::path::Path::new(directory)
            .join(".glue-paste")
            .join("reports");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{execution_id}.json"));
        let json = serde_json::to_string_pretty(data)
            .map_err(std::io::Error::other)?;
        std::fs::write(path, json)?;
        Ok(())
    })();
}

// ---------------------------------------------------------------------------
// run_haiku
// ---------------------------------------------------------------------------

/// Async runs the Anthropic haiku model via the `claude` CLI, returns stdout or None on failure.
pub async fn run_haiku(prompt: &str) -> Option<String> {
    let env: HashMap<String, String> = get_fresh_env();

    let output = Command::new("claude")
        .args(["-p", prompt, "--output-format", "text", "--max-turns", "2", "--model", EXTRACT_MODEL])
        .env_clear()
        .envs(&env)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

// ---------------------------------------------------------------------------
// extract_plan_report
// ---------------------------------------------------------------------------

/// Returns last `n` chars of `s` (by char count, not bytes).
fn last_chars(s: &str, n: usize) -> &str {
    let char_count = s.chars().count();
    if char_count <= n {
        return s;
    }
    let skip = char_count - n;
    let byte_offset = s
        .char_indices()
        .nth(skip)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    &s[byte_offset..]
}

/// Returns first `n` chars of `s` (by char count, not bytes).
fn first_chars(s: &str, n: usize) -> &str {
    let byte_end = s
        .char_indices()
        .nth(n)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    &s[..byte_end]
}

pub async fn extract_plan_report(args: &PlanReportArgs) -> Option<PlanReport> {
    let prompt = format!(
        r#"You analyze an AI implementation PLAN and extract structure. Reply with ONLY a JSON object, no prose, matching:
{{"criteria": string[], "plan_summary": {{"key_files": string[], "risks": string[], "dependencies": string[]}}}}
- "criteria": 2-6 concrete, checkable acceptance criteria the finished work must satisfy.
- "key_files": files the plan will create or modify.
- "risks"/"dependencies": short bullet phrases (may be empty arrays).

TASK TITLE: {title}
TASK DESCRIPTION: {description}

PLAN:
{plan}"#,
        title = args.title,
        description = first_chars(&args.description, 2000),
        plan = last_chars(&args.plan_output, 6000),
    );

    let output = run_haiku(&prompt).await?;
    parse_report_json::<PlanReport>(&output)
}

// ---------------------------------------------------------------------------
// extract_execute_report
// ---------------------------------------------------------------------------

pub async fn extract_execute_report(args: &ExecuteReportArgs) -> Option<ExecuteReport> {
    let criteria_list = if args.criteria.is_empty() {
        "(none)".to_string()
    } else {
        args.criteria
            .iter()
            .map(|c| format!("[{}] {}", c.id, c.text))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let files_list = if args.files_changed.is_empty() {
        "(none)".to_string()
    } else {
        args.files_changed
            .iter()
            .map(|f| format!("{} (+{}/−{})", f.path, f.additions, f.deletions))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt = format!(
        r#"You verify whether an AI execution satisfied each acceptance criterion. Reply with ONLY a JSON object, no prose, matching:
{{"criteria": [{{"id": string, "status": "pass"|"fail", "evidence": string}}], "completion_summary": string, "blocker": {{"type": string, "root_cause": string, "resolution_route": string}} | null}}
- Return one entry per criterion id below; "evidence" cites a test result, command, or changed file (short).
- "completion_summary": one sentence on what shipped (empty if the run failed).
- "blocker": non-null ONLY if the run failed; otherwise null.

CRITERIA:
{criteria_list}

EXIT CODE: {exit_code}
CHANGED FILES:
{files_list}

EXECUTION OUTPUT:
{output}"#,
        criteria_list = criteria_list,
        exit_code = args.exit_code,
        files_list = files_list,
        output = last_chars(&args.output, 6000),
    );

    let output = run_haiku(&prompt).await?;
    parse_report_json::<ExecuteReport>(&output)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fenced_json_block() {
        let text = r#"Here is the result:
```json
{"criteria": [{"id": "c1", "status": "pass", "evidence": "test passed"}], "completion_summary": "done", "blocker": null}
```
Some trailing text."#;
        let result = parse_report_json::<ExecuteReport>(text);
        assert!(result.is_some(), "should parse fenced json block");
        let report = result.unwrap();
        assert_eq!(report.criteria.len(), 1);
        assert_eq!(report.criteria[0].id, "c1");
    }

    #[test]
    fn parses_bare_json_object() {
        let text = r#"{"criteria":[],"completion_summary":"","blocker":null}"#;
        let result = parse_report_json::<ExecuteReport>(text);
        assert!(result.is_some(), "should parse bare json object");
    }

    #[test]
    fn returns_none_on_garbage() {
        let result = parse_report_json::<ExecuteReport>("not json at all");
        assert!(result.is_none(), "should return None on garbage input");
    }

    #[test]
    fn write_report_file_writes_under_glue_paste_reports() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap().to_string();
        let execution_id = "test-exec-123";

        let report = ExecuteReport {
            criteria: vec![CriterionResult {
                id: "c1".to_string(),
                status: "pass".to_string(),
                evidence: "all good".to_string(),
            }],
            completion_summary: "shipped".to_string(),
            blocker: None,
        };

        write_report_file(&dir, execution_id, &report);

        let expected_path = tmp
            .path()
            .join(".glue-paste")
            .join("reports")
            .join(format!("{execution_id}.json"));
        assert!(expected_path.exists(), "report file should exist at expected path");

        let contents = std::fs::read_to_string(&expected_path).unwrap();
        let parsed: ExecuteReport = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, report);
    }
}
