use regex::Regex;
use std::sync::OnceLock;

/// Strips ANSI escape codes from a string slice.
fn strip_ansi(s: &str) -> String {
    static ANSI_RE: OnceLock<Regex> = OnceLock::new();
    let re = ANSI_RE.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
    re.replace_all(s, "").into_owned()
}

/// Trailing characters of the buffer to inspect.
const TAIL: usize = 4000;

/// Accepted input to send to approve the permission prompt (Enter key).
pub const ACCEPT_INPUT: &str = "\r";

/// Returns `Some(ACCEPT_INPUT)` when the buffer contains a Claude permission prompt.
///
/// Mirrors the TypeScript `detectPermissionPrompt`: strips ANSI + whitespace, then
/// checks for both "doyouwantto" and "1.?yes" (case-insensitive).
pub fn detect_permission_prompt(buffer: &str) -> Option<&'static str> {
    static QUESTION_RE: OnceLock<Regex> = OnceLock::new();
    static YES_RE: OnceLock<Regex> = OnceLock::new();

    let question_re = QUESTION_RE.get_or_init(|| Regex::new(r"(?i)doyouwantto").unwrap());
    let yes_re = YES_RE.get_or_init(|| Regex::new(r"(?i)1\.?yes").unwrap());

    let tail = if buffer.len() > TAIL {
        &buffer[buffer.len() - TAIL..]
    } else {
        buffer
    };

    let stripped = strip_ansi(tail);
    // Remove all whitespace before matching
    let flat: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    if question_re.is_match(&flat) && yes_re.is_match(&flat) {
        Some(ACCEPT_INPUT)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_canonical_permission_prompt() {
        let buf = "Do you want to create hello.txt?\n\x1b[0m\u{276f}1.Yes 2.Yes, and don't ask... 3.No";
        assert!(detect_permission_prompt(buf).is_some());
    }

    #[test]
    fn no_match_for_normal_output() {
        let buf = "Running cargo build...\nCompiling foo v0.1";
        assert!(detect_permission_prompt(buf).is_none());
    }
}
