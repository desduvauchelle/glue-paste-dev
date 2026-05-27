use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

// ---------------------------------------------------------------------------
// Shell PATH — resolved once at first call
// ---------------------------------------------------------------------------

static SHELL_PATH: OnceLock<String> = OnceLock::new();

fn resolve_shell_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();

    for shell in &["zsh", "bash"] {
        let result = std::process::Command::new(shell)
            .args(["-l", "-c", "echo $PATH"])
            .env_clear()
            .env("HOME", &home)
            .env("PATH", &current_path)
            .output();

        if let Ok(output) = result {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let trimmed = stdout.trim().to_string();
                if !trimmed.is_empty() {
                    return trimmed;
                }
            }
        }
    }

    current_path
}

fn get_shell_path() -> &'static str {
    SHELL_PATH.get_or_init(resolve_shell_path)
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

fn looks_like_oauth_token(token: &str) -> bool {
    token.len() >= 40 && !token.starts_with("test-") && !token.starts_with("test_")
}

// ---------------------------------------------------------------------------
// Keychain JSON shape
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeychainCreds {
    claude_ai_oauth: Option<ClaudeAiOauth>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAiOauth {
    access_token: Option<String>,
    expires_at: Option<i64>,
}

// ---------------------------------------------------------------------------
// 5-second cache
// ---------------------------------------------------------------------------

static ENV_CACHE: Mutex<Option<(HashMap<String, String>, Instant)>> = Mutex::new(None);
const ENV_CACHE_TTL: Duration = Duration::from_secs(5);

/// Returns env vars for spawning CLI subprocesses with the freshest OAuth token.
/// Results cached for 5s. Internally resolves login-shell PATH once on first call.
pub fn get_fresh_env() -> HashMap<String, String> {
    // Check cache
    {
        let guard = ENV_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ref cached_map, cached_at)) = *guard {
            if cached_at.elapsed() < ENV_CACHE_TTL {
                return cached_map.clone();
            }
        }
    }

    let shell_path = get_shell_path();

    // Build base env from process environment with overridden PATH
    let mut base: HashMap<String, String> = std::env::vars().collect();
    base.insert("PATH".to_string(), shell_path.to_string());

    let mut result: Option<HashMap<String, String>> = None;

    // 1. Token file (~/.glue-paste-dev/oauth-token)
    if let Some(home) = dirs::home_dir() {
        let token_path = home.join(".glue-paste-dev").join("oauth-token");
        if let Ok(contents) = std::fs::read_to_string(&token_path) {
            let token = contents.trim().to_string();
            if !token.is_empty() && looks_like_oauth_token(&token) {
                let mut env = base.clone();
                env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token);
                result = Some(env);
            }
        }
    }

    // 2. macOS Keychain
    #[cfg(target_os = "macos")]
    if result.is_none() {
        let kc = std::process::Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output();

        if let Ok(output) = kc {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let json_str = stdout.trim();
                if let Ok(creds) = serde_json::from_str::<KeychainCreds>(json_str) {
                    if let Some(oauth) = creds.claude_ai_oauth {
                        if let (Some(token), Some(expires_at)) = (oauth.access_token, oauth.expires_at) {
                            let now_ms = chrono::Utc::now().timestamp_millis();
                            if now_ms < expires_at - 60_000 && looks_like_oauth_token(&token) {
                                let mut env = base.clone();
                                env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token);
                                result = Some(env);
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Fallback: base env with shell PATH
    let env = result.unwrap_or(base);

    // Update cache
    {
        let mut guard = ENV_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some((env.clone(), Instant::now()));
    }

    env
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_like_oauth_token_short_string_false() {
        assert!(!looks_like_oauth_token("short"));
        assert!(!looks_like_oauth_token(""));
        assert!(!looks_like_oauth_token("abc123"));
    }

    #[test]
    fn looks_like_oauth_token_test_prefix_false() {
        // 40+ chars but starts with test-
        let token = "test-abcdefghijklmnopqrstuvwxyz0123456789";
        assert!(token.len() >= 40);
        assert!(!looks_like_oauth_token(token));

        let token2 = "test_abcdefghijklmnopqrstuvwxyz0123456789";
        assert!(token2.len() >= 40);
        assert!(!looks_like_oauth_token(token2));
    }

    #[test]
    fn looks_like_oauth_token_real_looking_true() {
        // 50-char hex-looking token
        let token = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6ab";
        assert!(token.len() >= 40);
        assert!(looks_like_oauth_token(token));
    }

    #[test]
    fn get_fresh_env_includes_path() {
        let env = get_fresh_env();
        let path = env.get("PATH").expect("PATH must be present");
        assert!(!path.is_empty(), "PATH must be non-empty");
    }

    #[test]
    fn get_fresh_env_caches() {
        // Two calls within the cache TTL should return the same PATH value
        let env1 = get_fresh_env();
        let env2 = get_fresh_env();
        assert_eq!(
            env1.get("PATH"),
            env2.get("PATH"),
            "cached calls should return consistent PATH"
        );
    }
}
