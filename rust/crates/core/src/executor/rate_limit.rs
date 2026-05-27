use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub struct RateLimitInfo {
    pub is_rate_limit: bool,
    pub is_overloaded: bool,
    pub reset_message: Option<String>,
}

// 13 rate-limit detection patterns (case-insensitive, `.` matches any char like JS)
static RATE_LIMIT_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

fn rate_limit_patterns() -> &'static Vec<Regex> {
    RATE_LIMIT_PATTERNS.get_or_init(|| {
        let raw = [
            r"(?i)rate.limit",
            r"429",
            r"(?i)too many requests",
            r"(?i)quota.exceeded",
            r"(?i)resource.exhausted",
            r"(?i)overloaded",
            r"(?i)capacity",
            r"(?i)throttl",
            r"(?i)usage.limit",
            r"(?i)request limit",
            r"(?i)token limit",
            r"(?i)exceeded.*limit",
            r"(?i)limit.*exceeded",
        ];
        raw.iter().map(|p| Regex::new(p).expect("valid regex")).collect()
    })
}

// 4 overloaded patterns
static OVERLOADED_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

fn overloaded_patterns() -> &'static Vec<Regex> {
    OVERLOADED_PATTERNS.get_or_init(|| {
        let raw = [
            r"529",
            r"(?i)overloaded",
            r"(?i)service.unavailable",
            r"(?i)server.busy",
        ];
        raw.iter().map(|p| Regex::new(p).expect("valid regex")).collect()
    })
}

// 5 reset-time extraction patterns
struct ResetPattern {
    regex: Regex,
    extract: fn(&regex::Captures) -> String,
}

static RESET_PATTERNS: OnceLock<Vec<ResetPattern>> = OnceLock::new();

fn reset_patterns() -> &'static Vec<ResetPattern> {
    RESET_PATTERNS.get_or_init(|| {
        vec![
            ResetPattern {
                regex: Regex::new(r"(?i)retry.after[:\s]+(\d+)\s*(seconds?|minutes?|hours?)")
                    .expect("valid regex"),
                extract: |c| format!("Retry after {} {}", &c[1], &c[2]),
            },
            ResetPattern {
                regex: Regex::new(r"(?i)try again in\s+(.+?)[.\n]").expect("valid regex"),
                extract: |c| format!("Try again in {}", &c[1]),
            },
            ResetPattern {
                regex: Regex::new(r"(?i)wait\s+(\d+)\s*(seconds?|minutes?|hours?)").expect("valid regex"),
                extract: |c| format!("Wait {} {}", &c[1], &c[2]),
            },
            ResetPattern {
                regex: Regex::new(r"(?i)resets?\s+(?:at|in)\s+(.+?)[.\n]").expect("valid regex"),
                extract: |c| format!("Resets {}", &c[1]),
            },
            ResetPattern {
                regex: Regex::new(r"(?i)available.(?:again|in)\s+(.+?)[.\n]").expect("valid regex"),
                extract: |c| format!("Available {}", &c[1]),
            },
        ]
    })
}

pub fn detect_rate_limit(stdout: &str, stderr: &str, exit_code: i32) -> RateLimitInfo {
    // Only check failures
    if exit_code == 0 {
        return RateLimitInfo {
            is_rate_limit: false,
            is_overloaded: false,
            reset_message: None,
        };
    }

    let combined = format!("{}\n{}", stderr, stdout);

    // Check overloaded patterns first
    let is_overloaded = overloaded_patterns().iter().any(|p| p.is_match(&combined));

    let is_rate_limit = is_overloaded || rate_limit_patterns().iter().any(|p| p.is_match(&combined));

    if !is_rate_limit {
        return RateLimitInfo {
            is_rate_limit: false,
            is_overloaded: false,
            reset_message: None,
        };
    }

    // Try to extract reset time from each reset pattern in order
    for rp in reset_patterns() {
        if let Some(caps) = rp.regex.captures(&combined) {
            return RateLimitInfo {
                is_rate_limit: true,
                is_overloaded,
                reset_message: Some((rp.extract)(&caps)),
            };
        }
    }

    // Default message
    let default_msg = if is_overloaded {
        "Claude servers are overloaded."
    } else {
        "Check provider dashboard for reset time."
    };

    RateLimitInfo {
        is_rate_limit: true,
        is_overloaded,
        reset_message: Some(default_msg.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_false_for_successful_exit_code() {
        let result = detect_rate_limit("rate limit exceeded", "", 0);
        assert!(!result.is_rate_limit);
        assert!(!result.is_overloaded);
    }

    #[test]
    fn detects_429_in_stderr() {
        let result = detect_rate_limit("", "HTTP 429 Too Many Requests", 1);
        assert!(result.is_rate_limit);
    }

    #[test]
    fn detects_rate_limit_text_in_stderr() {
        let result = detect_rate_limit("", "Error: rate limit exceeded", 1);
        assert!(result.is_rate_limit);
    }

    #[test]
    fn detects_quota_exceeded() {
        let result = detect_rate_limit("", "quota exceeded for model", 1);
        assert!(result.is_rate_limit);
    }

    #[test]
    fn detects_throttling() {
        let result = detect_rate_limit("", "Request was throttled", 1);
        assert!(result.is_rate_limit);
    }

    #[test]
    fn detects_resource_exhausted() {
        let result = detect_rate_limit("", "RESOURCE_EXHAUSTED: tokens per minute", 1);
        assert!(result.is_rate_limit);
    }

    #[test]
    fn extracts_retry_after_time() {
        let result = detect_rate_limit("", "rate limit exceeded. Retry after 3600 seconds.", 1);
        assert!(result.is_rate_limit);
        assert_eq!(result.reset_message.as_deref(), Some("Retry after 3600 seconds"));
    }

    #[test]
    fn extracts_try_again_in_time() {
        let result = detect_rate_limit("", "Too many requests. Try again in 2 hours.", 1);
        assert!(result.is_rate_limit);
        assert_eq!(result.reset_message.as_deref(), Some("Try again in 2 hours"));
    }

    #[test]
    fn extracts_wait_time() {
        let result = detect_rate_limit("", "Rate limited. Please wait 30 minutes.", 1);
        assert!(result.is_rate_limit);
        assert_eq!(result.reset_message.as_deref(), Some("Wait 30 minutes"));
    }

    #[test]
    fn returns_default_message_when_no_reset_time_found() {
        let result = detect_rate_limit("", "429 Too Many Requests", 1);
        assert!(result.is_rate_limit);
        assert_eq!(
            result.reset_message.as_deref(),
            Some("Check provider dashboard for reset time.")
        );
    }

    #[test]
    fn returns_false_for_unrelated_errors() {
        let result = detect_rate_limit("", "file not found", 1);
        assert!(!result.is_rate_limit);
        assert!(!result.is_overloaded);
    }
}
