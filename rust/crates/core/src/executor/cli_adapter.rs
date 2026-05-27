use crate::types::ExecutionPhase;

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub cli_provider: String,
    pub model: String,
    pub max_budget_usd: f64,
    pub cli_custom_command: String,
    pub plan_thinking: String,
    pub execute_thinking: String,
}

#[derive(Debug, Clone)]
pub struct CliCommand {
    pub args: Vec<String>,
    pub supports_stream_json: bool,
    pub supports_session: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CliAdapterError {
    #[error("Custom CLI provider selected but no command configured. Set cli_custom_command in config.")]
    EmptyCustomCommand,
    #[error("Unknown CLI provider: {0}")]
    UnknownProvider(String),
}

pub fn build_cli_command(
    config: &CliConfig,
    prompt: &str,
    session_id: &str,
    phase: ExecutionPhase,
    resume: bool,
) -> Result<CliCommand, CliAdapterError> {
    match config.cli_provider.as_str() {
        "claude" => Ok(build_claude_command(config, prompt, session_id, phase, resume)),
        "gemini" => Ok(build_gemini_command(config, prompt)),
        "codex" => Ok(build_codex_command(config, prompt)),
        "aider" => Ok(build_aider_command(config, prompt)),
        "copilot" => Ok(build_copilot_command(config, prompt, session_id, phase, resume)),
        "custom" => build_custom_command(config, prompt),
        other => Err(CliAdapterError::UnknownProvider(other.to_string())),
    }
}

fn build_claude_command(
    config: &CliConfig,
    prompt: &str,
    session_id: &str,
    phase: ExecutionPhase,
    resume: bool,
) -> CliCommand {
    let mut args = vec![
        "claude".to_string(),
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--append-system-prompt".to_string(),
        "IMPORTANT: Do not add any Co-authored-by trailers or similar attribution to git commits. All commits must be authored solely by the user's git identity. Do not modify git author or committer configuration.".to_string(),
    ];

    if resume {
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    } else {
        args.push("--session-id".to_string());
        args.push(session_id.to_string());
    }

    if !config.model.is_empty() {
        args.push("--model".to_string());
        args.push(config.model.clone());
    }

    if config.max_budget_usd > 0.0 {
        args.push("--max-budget-usd".to_string());
        args.push(config.max_budget_usd.to_string());
    }

    if phase == ExecutionPhase::Execute {
        args.push("--dangerously-skip-permissions".to_string());
    }

    CliCommand {
        args,
        supports_stream_json: true,
        supports_session: true,
    }
}

fn build_gemini_command(config: &CliConfig, prompt: &str) -> CliCommand {
    let mut args = vec![
        "gemini".to_string(),
        "-p".to_string(),
        prompt.to_string(),
    ];

    if !config.model.is_empty() {
        args.push("--model".to_string());
        args.push(config.model.clone());
    }

    CliCommand {
        args,
        supports_stream_json: false,
        supports_session: false,
    }
}

fn build_codex_command(config: &CliConfig, prompt: &str) -> CliCommand {
    let mut args = vec!["codex".to_string(), prompt.to_string()];

    if !config.model.is_empty() {
        args.push("--model".to_string());
        args.push(config.model.clone());
    }

    args.push("--auto-confirm".to_string());

    CliCommand {
        args,
        supports_stream_json: false,
        supports_session: false,
    }
}

fn build_aider_command(config: &CliConfig, prompt: &str) -> CliCommand {
    let mut args = vec![
        "aider".to_string(),
        "--message".to_string(),
        prompt.to_string(),
        "--yes".to_string(),
    ];

    if !config.model.is_empty() {
        args.push("--model".to_string());
        args.push(config.model.clone());
    }

    CliCommand {
        args,
        supports_stream_json: false,
        supports_session: false,
    }
}

fn build_copilot_command(
    config: &CliConfig,
    prompt: &str,
    session_id: &str,
    phase: ExecutionPhase,
    resume: bool,
) -> CliCommand {
    let one_shot_prefix = if phase == ExecutionPhase::Plan {
        "Produce a concrete implementation plan immediately."
    } else {
        "Execute the task immediately using reasonable assumptions."
    };

    // On Windows, copilot is a .cmd file executed via cmd.exe, which treats embedded newlines
    // as command separators. Flatten to a single line so the full prompt reaches Copilot.
    let raw = format!("{}\n{}", one_shot_prefix, prompt);
    let one_shot_prompt: String = raw
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" | ");

    let thinking_effort = if phase == ExecutionPhase::Plan {
        if config.plan_thinking.is_empty() {
            "smart"
        } else {
            &config.plan_thinking
        }
    } else if config.execute_thinking.is_empty() {
        "smart"
    } else {
        &config.execute_thinking
    };
    let effort = if thinking_effort == "smart" { "high" } else { "medium" };

    let mut args = vec![
        "copilot".to_string(),
        "-p".to_string(),
        one_shot_prompt,
        "--allow-all-tools".to_string(),
        "--no-ask-user".to_string(),
        "--output-format".to_string(),
        "json".to_string(),
        "--stream".to_string(),
        "on".to_string(),
        "--silent".to_string(),
        "--effort".to_string(),
        effort.to_string(),
    ];

    // Only resume an existing session; plan phase always starts fresh
    if resume && !session_id.is_empty() {
        args.push(format!("--resume={}", session_id));
    }

    CliCommand {
        args,
        supports_stream_json: true,
        supports_session: true,
    }
}

fn build_custom_command(config: &CliConfig, prompt: &str) -> Result<CliCommand, CliAdapterError> {
    let custom_cmd = config.cli_custom_command.trim();
    if custom_cmd.is_empty() {
        return Err(CliAdapterError::EmptyCustomCommand);
    }

    let mut args: Vec<String> = custom_cmd.split_whitespace().map(|s| s.to_string()).collect();
    args.push(prompt.to_string());

    Ok(CliCommand {
        args,
        supports_stream_json: false,
        supports_session: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ExecutionPhase;

    fn default_config() -> CliConfig {
        CliConfig {
            cli_provider: "claude".into(),
            model: "claude-opus-4-6".into(),
            max_budget_usd: 0.0,
            cli_custom_command: String::new(),
            plan_thinking: "smart".into(),
            execute_thinking: "smart".into(),
        }
    }

    #[test]
    fn claude_builds_with_stream_json() {
        let config = default_config();
        let result = build_cli_command(&config, "do stuff", "sess-1", ExecutionPhase::Plan, false).unwrap();
        assert_eq!(result.args[0], "claude");
        assert!(result.args.contains(&"--output-format".to_string()));
        assert!(result.args.contains(&"stream-json".to_string()));
        assert!(result.supports_stream_json);
        assert!(result.supports_session);
    }

    #[test]
    fn execute_phase_adds_dangerously_skip_permissions() {
        let config = default_config();
        let result = build_cli_command(&config, "do stuff", "sess-1", ExecutionPhase::Execute, false).unwrap();
        assert!(result.args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn plan_phase_omits_dangerously_skip_permissions() {
        let config = default_config();
        let result = build_cli_command(&config, "do stuff", "sess-1", ExecutionPhase::Plan, false).unwrap();
        assert!(!result.args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn gemini_command() {
        let config = CliConfig {
            cli_provider: "gemini".into(),
            model: "gemini-pro".into(),
            ..default_config()
        };
        let result = build_cli_command(&config, "do stuff", "", ExecutionPhase::Plan, false).unwrap();
        assert_eq!(result.args[0], "gemini");
        assert!(result.args.contains(&"gemini-pro".to_string()));
        assert!(!result.supports_stream_json);
    }

    #[test]
    fn codex_command() {
        let config = CliConfig {
            cli_provider: "codex".into(),
            ..default_config()
        };
        let result = build_cli_command(&config, "do stuff", "", ExecutionPhase::Plan, false).unwrap();
        assert_eq!(result.args[0], "codex");
        assert!(!result.supports_stream_json);
    }

    #[test]
    fn aider_command() {
        let config = CliConfig {
            cli_provider: "aider".into(),
            ..default_config()
        };
        let result = build_cli_command(&config, "do stuff", "", ExecutionPhase::Plan, false).unwrap();
        assert_eq!(result.args[0], "aider");
        assert!(result.args.contains(&"--message".to_string()));
        assert!(result.args.contains(&"--yes".to_string()));
    }

    #[test]
    fn custom_command_uses_cli_custom_command() {
        let config = CliConfig {
            cli_provider: "custom".into(),
            cli_custom_command: "my-tool --verbose".into(),
            ..default_config()
        };
        let result = build_cli_command(&config, "do stuff", "", ExecutionPhase::Plan, false).unwrap();
        assert_eq!(result.args[0], "my-tool");
        assert_eq!(result.args[1], "--verbose");
        assert_eq!(result.args[2], "do stuff");
    }

    #[test]
    fn custom_command_empty_returns_error() {
        let config = CliConfig {
            cli_provider: "custom".into(),
            cli_custom_command: String::new(),
            ..default_config()
        };
        let result = build_cli_command(&config, "do stuff", "", ExecutionPhase::Plan, false);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CliAdapterError::EmptyCustomCommand));
    }

    #[test]
    fn resume_true_uses_resume_flag() {
        let config = default_config();
        let result = build_cli_command(&config, "do stuff", "sess-1", ExecutionPhase::Plan, true).unwrap();
        assert!(result.args.contains(&"--resume".to_string()));
        assert!(result.args.contains(&"sess-1".to_string()));
        assert!(!result.args.contains(&"--session-id".to_string()));
    }

    #[test]
    fn resume_false_uses_session_id() {
        let config = default_config();
        let result = build_cli_command(&config, "do stuff", "sess-1", ExecutionPhase::Plan, false).unwrap();
        assert!(!result.args.contains(&"--resume".to_string()));
        assert!(result.args.contains(&"--session-id".to_string()));
    }
}
