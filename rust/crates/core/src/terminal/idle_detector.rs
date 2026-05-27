use regex::Regex;
use std::sync::OnceLock;

/// Trailing characters of the buffer to inspect.
const TAIL: usize = 2000;

/// Strips ANSI escape codes from a string slice.
fn strip_ansi(s: &str) -> String {
    static ANSI_RE: OnceLock<Regex> = OnceLock::new();
    let re = ANSI_RE.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[A-Za-z]").unwrap());
    re.replace_all(s, "").into_owned()
}

/// Return true if `flat` contains `❯` (U+276F) NOT immediately followed by an ASCII digit.
///
/// The Rust `regex` crate does not support lookahead, so we scan manually.
fn has_input_box_caret(flat: &str) -> bool {
    const CARET: char = '\u{276f}'; // ❯
    let mut chars = flat.char_indices().peekable();
    while let Some((_, c)) = chars.next() {
        if c == CARET {
            match chars.peek() {
                // ❯ at end of string — counts as input box
                None => return true,
                // ❯ not followed by a digit — counts as input box
                Some((_, next)) if !next.is_ascii_digit() => return true,
                // ❯ followed by a digit — menu item, keep scanning
                _ => {}
            }
        }
    }
    false
}

/// Best-effort idle / turn-complete detector.
///
/// Mirrors TypeScript `detectIdle`:
///   1. Tail must contain `❯` NOT immediately followed by a digit (input box, not a menu).
///   2. Tail must NOT contain "doyouwantto" (not a permission prompt).
pub fn detect_idle(buffer: &str) -> bool {
    static PERMISSION_RE: OnceLock<Regex> = OnceLock::new();

    if buffer.is_empty() {
        return false;
    }

    let tail = if buffer.len() > TAIL {
        &buffer[buffer.len() - TAIL..]
    } else {
        buffer
    };

    let stripped = strip_ansi(tail);
    // Collapse all whitespace
    let flat: String = stripped.chars().filter(|c| !c.is_whitespace()).collect();

    if !has_input_box_caret(&flat) {
        return false;
    }

    let permission_re =
        PERMISSION_RE.get_or_init(|| Regex::new(r"(?i)doyouwantto").unwrap());
    if permission_re.is_match(&flat) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_detects_input_box_caret() {
        // ❯ not followed by a digit = input box = idle
        let buf = "\u{276f}Try \"create a util...\"";
        assert!(detect_idle(buf));
    }

    #[test]
    fn idle_not_triggered_by_permission_menu() {
        let buf = "Do you want to create hello.txt? \u{276f}1. Yes 2. No";
        assert!(!detect_idle(buf));
    }

    #[test]
    fn idle_not_triggered_on_empty() {
        assert!(!detect_idle(""));
    }
}
