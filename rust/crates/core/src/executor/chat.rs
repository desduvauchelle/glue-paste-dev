use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};

use rusqlite::Connection;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::db::{comments, executions};
use crate::executor::{
    build_cli_command, build_prompt, get_fresh_env, kill_process_tree, parse_stream_line,
    CliConfig, CliAdapterError, PromptConfig, PromptContext, StreamEventKind,
};
use crate::types::{Board, CardWithTags, Comment, CommentAuthor, CreateComment, ExecutionPhase};
use crate::Result;

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub enum ChatMode {
    Plan,
    Execute,
}

#[derive(Debug, Clone, Copy)]
pub enum ChatThinking {
    Smart,
    Basic,
}

fn thinking_to_model(t: ChatThinking) -> &'static str {
    match t {
        ChatThinking::Smart => "claude-opus-4-6",
        ChatThinking::Basic => "claude-sonnet-4-6",
    }
}

/// Configuration needed by `run_chat`.
#[derive(Clone)]
pub struct ChatConfig {
    pub cli_provider: String,
    pub model: String,
    pub max_budget_usd: f64,
    pub cli_custom_command: String,
    pub plan_thinking: String,
    pub execute_thinking: String,
    pub custom_instructions: String,
    pub auto_commit: bool,
    pub auto_push: bool,
    pub branch_mode: String,
}

pub struct ChatOptions<'a> {
    pub card: &'a CardWithTags,
    pub board: &'a Board,
    pub comments: &'a [Comment],
    pub config: &'a ChatConfig,
    pub mode: ChatMode,
    pub user_message: String,
    pub thinking: ChatThinking,
    pub card_files: Vec<String>,
}

pub trait ChatCallbacks: Send + Sync {
    fn on_output(&self, card_id: &str, chunk: &str);
    fn on_completed(&self, card_id: &str, comment: &Comment);
    fn on_comment_added(&self, comment: &Comment);
}

// ---------------------------------------------------------------------------
// Active-process registry
// ---------------------------------------------------------------------------

/// PIDs of currently-running chat subprocesses, keyed by card_id.
static ACTIVE_CHAT_PROCESSES: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Kills the active chat process for a card. Returns `true` if a process was killed.
pub fn kill_chat_process(card_id: &str) -> bool {
    let pid = {
        let mut map = ACTIVE_CHAT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(card_id)
    };
    if let Some(pid) = pid {
        kill_process_tree(pid as i32);
        true
    } else {
        false
    }
}

/// Kills all active chat processes.
pub fn kill_all_chat_processes() {
    let pids: Vec<(String, u32)> = {
        let mut map = ACTIVE_CHAT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.drain().collect()
    };
    for (_card_id, pid) in pids {
        kill_process_tree(pid as i32);
    }
}

/// Returns `true` if there is an active chat process for the given card.
pub fn has_chat_process(card_id: &str) -> bool {
    let map = ACTIVE_CHAT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
    map.contains_key(card_id)
}

// ---------------------------------------------------------------------------
// run_chat
// ---------------------------------------------------------------------------

/// Runs an interactive chat message for a card.
///
/// 1. Saves the user message as a `Comment` (author = User).
/// 2. Resolves or creates a session_id; sets `resume` flag accordingly.
/// 3. Builds the chat prompt.
/// 4. Spawns the CLI subprocess, streams its output.
/// 5. Saves the AI response as a `Comment` (author = Ai), calls callbacks.
pub async fn run_chat(
    db: Arc<Mutex<Connection>>,
    options: ChatOptions<'_>,
    callbacks: Arc<dyn ChatCallbacks>,
) -> Result<()> {
    let ChatOptions {
        card,
        board,
        comments,
        config,
        mode,
        user_message,
        thinking,
        card_files,
    } = options;

    let card_id = card.card.id.clone();

    // 1. Save user message
    let user_comment = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        comments::create(
            &conn,
            &card_id,
            &CreateComment {
                author: CommentAuthor::User,
                content: user_message.clone(),
                execution_id: None,
            },
        )?
    };
    callbacks.on_comment_added(&user_comment);

    // Append user comment to history for prompt building
    let mut chat_comments: Vec<Comment> = comments.to_vec();
    chat_comments.push(user_comment.clone());

    // 2. Resolve session_id and resume flag
    let existing_session_id = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::get_last_session_id(&conn, &card_id)?
    };
    let session_id = existing_session_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let resume = existing_session_id.is_some();

    // 3. Build prompt
    let model = if config.model.is_empty() {
        thinking_to_model(thinking).to_string()
    } else {
        config.model.clone()
    };

    let prompt = build_chat_prompt(BuildChatPromptArgs {
        card,
        board,
        comments: &chat_comments,
        mode,
        user_message: &user_message,
        custom_instructions: &config.custom_instructions,
        auto_commit: config.auto_commit,
        auto_push: config.auto_push,
        branch_mode: &config.branch_mode,
        card_files: &card_files,
    });

    // 4. Build CLI command
    let cli_config = CliConfig {
        cli_provider: config.cli_provider.clone(),
        model,
        max_budget_usd: config.max_budget_usd,
        cli_custom_command: config.cli_custom_command.clone(),
        plan_thinking: config.plan_thinking.clone(),
        execute_thinking: config.execute_thinking.clone(),
    };

    let phase = match mode {
        ChatMode::Plan => ExecutionPhase::Plan,
        ChatMode::Execute => ExecutionPhase::Execute,
    };

    let cli_cmd = build_cli_command(&cli_config, &prompt, &session_id, phase, resume)
        .map_err(|e: CliAdapterError| crate::Error::Io(std::io::Error::other(e.to_string())))?;

    // 5. Spawn subprocess
    let args = &cli_cmd.args;
    let env_map: HashMap<String, String> = get_fresh_env();

    let mut cmd = Command::new(&args[0]);
    cmd.args(&args[1..])
        .current_dir(&board.directory)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in &env_map {
        cmd.env(k, v);
    }

    let mut child = cmd
        .spawn()
        .map_err(crate::Error::Io)?;

    // Register PID
    let pid = child.id().unwrap_or(0);
    if pid > 0 {
        let mut map = ACTIVE_CHAT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(card_id.clone(), pid);
    }

    // Stream stdout
    const MAX_CHAT_OUTPUT: usize = 100 * 1024; // 100 KB
    let mut output = String::new();

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    if cli_cmd.supports_stream_json {
                        if let Some(event) = parse_stream_line(&line) {
                            if event.kind == StreamEventKind::Text
                                || event.kind == StreamEventKind::ToolUse
                            {
                                output.push_str(&event.content);
                                callbacks.on_output(&card_id, &event.content);
                            }
                        }
                    } else if !line.trim().is_empty() {
                        let chunk = format!("{}\n", line);
                        output.push_str(&chunk);
                        callbacks.on_output(&card_id, &chunk);
                    }

                    // Cap in-memory output to a tail of MAX_CHAT_OUTPUT
                    if output.len() > MAX_CHAT_OUTPUT * 3 / 2 {
                        let keep_from = output.len() - MAX_CHAT_OUTPUT;
                        output = output[keep_from..].to_string();
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }

    let _ = child.wait().await;

    // Remove from active map
    {
        let mut map = ACTIVE_CHAT_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&card_id);
    }

    // 8. Save AI response
    let response_content = if output.trim().is_empty() {
        "(No response)".to_string()
    } else {
        output.trim().to_string()
    };

    let ai_comment = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        comments::create(
            &conn,
            &card_id,
            &CreateComment {
                author: CommentAuthor::Ai,
                content: response_content,
                execution_id: None,
            },
        )?
    };

    callbacks.on_comment_added(&ai_comment);
    callbacks.on_completed(&card_id, &ai_comment);

    Ok(())
}

// ---------------------------------------------------------------------------
// build_chat_prompt
// ---------------------------------------------------------------------------

struct BuildChatPromptArgs<'a> {
    card: &'a CardWithTags,
    board: &'a Board,
    comments: &'a [Comment],
    mode: ChatMode,
    user_message: &'a str,
    custom_instructions: &'a str,
    auto_commit: bool,
    auto_push: bool,
    branch_mode: &'a str,
    card_files: &'a [String],
}

fn build_chat_prompt(args: BuildChatPromptArgs<'_>) -> String {
    let BuildChatPromptArgs {
        card,
        board,
        comments,
        mode,
        user_message,
        custom_instructions,
        auto_commit,
        auto_push,
        branch_mode,
        card_files,
    } = args;

    // Resolve attachment paths
    let attach_dir = Path::new(&board.directory)
        .join(".glue-paste")
        .join("attachments")
        .join(&card.card.id);
    let attachment_paths: Vec<String> = std::fs::read_dir(&attach_dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .map(|name| format!(".glue-paste/attachments/{}/{}", card.card.id, name))
                .collect()
        })
        .unwrap_or_default();

    let prompt_config = PromptConfig {
        custom_instructions: custom_instructions.to_string(),
        auto_commit,
        auto_push,
        branch_mode: branch_mode.to_string(),
    };

    let phase = match mode {
        ChatMode::Plan => ExecutionPhase::Plan,
        ChatMode::Execute => ExecutionPhase::Execute,
    };

    let base_prompt = build_prompt(&PromptContext {
        card,
        board,
        comments,
        config: &prompt_config,
        phase,
        plan_output: None,
        attachment_paths: &attachment_paths,
        criteria: &[],
        files: card_files,
    });

    let mut parts = vec![base_prompt, String::new()];

    match mode {
        ChatMode::Plan => {
            parts.push("## Chat Mode: Plan".to_string());
            parts.push(
                "You are in a collaborative planning conversation with the user.".to_string(),
            );
            parts.push(
                "Analyze, discuss, and help plan the implementation. Do NOT make any code changes."
                    .to_string(),
            );
            parts.push("Respond conversationally to the user's message.".to_string());
        }
        ChatMode::Execute => {
            parts.push("## Chat Mode: Execute".to_string());
            parts.push("You are in an execution conversation with the user.".to_string());
            parts.push(
                "Implement the changes discussed. You may modify files and make code changes."
                    .to_string(),
            );
            parts.push(
                "Respond to the user's message and take action as requested.".to_string(),
            );
        }
    }

    parts.push(String::new());
    parts.push("## User's Message".to_string());
    parts.push(user_message.to_string());

    parts.join("\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory, executions};
    use crate::types::{Assignee, Card, CardStatus, CardWithTags, CreateBoard, CreateCard, ExecutionPhase};

    fn make_board() -> Board {
        Board {
            id: "b1".into(),
            name: "Test Board".into(),
            description: String::new(),
            directory: "/tmp".into(),
            session_id: None,
            color: None,
            scratchpad: String::new(),
            slug: None,
            github_url: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn make_card(id: &str) -> CardWithTags {
        CardWithTags {
            card: Card {
                id: id.into(),
                board_id: "b1".into(),
                title: "Test Card".into(),
                description: String::new(),
                status: CardStatus::Todo,
                position: 0,
                blocking: 0,
                plan_thinking: None,
                execute_thinking: None,
                auto_commit: None,
                auto_push: None,
                assignee: Assignee::Ai,
                cli_provider: None,
                cli_custom_command: None,
                branch_mode: None,
                branch_name: None,
                plan_summary: None,
                completion_summary: None,
                blocker: None,
                created_at: String::new(),
                updated_at: String::new(),
            },
            tags: vec![],
        }
    }

    #[test]
    fn thinking_to_model_smart() {
        assert_eq!(thinking_to_model(ChatThinking::Smart), "claude-opus-4-6");
    }

    #[test]
    fn thinking_to_model_basic() {
        assert_eq!(thinking_to_model(ChatThinking::Basic), "claude-sonnet-4-6");
    }

    #[test]
    fn has_chat_process_initial_false() {
        assert!(!has_chat_process("nonexistent-card-id"));
    }

    #[test]
    fn build_chat_prompt_contains_user_message() {
        let board = make_board();
        let card = make_card("c1");
        let prompt = build_chat_prompt(BuildChatPromptArgs {
            card: &card,
            board: &board,
            comments: &[],
            mode: ChatMode::Plan,
            user_message: "What should I implement?",
            custom_instructions: "",
            auto_commit: false,
            auto_push: false,
            branch_mode: "current",
            card_files: &[],
        });
        assert!(
            prompt.contains("What should I implement?"),
            "prompt should include the user message verbatim"
        );
        assert!(prompt.contains("## User's Message"));
    }

    #[test]
    fn build_chat_prompt_plan_mode_instructions() {
        let board = make_board();
        let card = make_card("c1");
        let prompt = build_chat_prompt(BuildChatPromptArgs {
            card: &card,
            board: &board,
            comments: &[],
            mode: ChatMode::Plan,
            user_message: "hello",
            custom_instructions: "",
            auto_commit: false,
            auto_push: false,
            branch_mode: "current",
            card_files: &[],
        });
        assert!(prompt.contains("## Chat Mode: Plan"));
        assert!(prompt.contains("Do NOT make any code changes."));
    }

    #[test]
    fn build_chat_prompt_execute_mode_instructions() {
        let board = make_board();
        let card = make_card("c1");
        let prompt = build_chat_prompt(BuildChatPromptArgs {
            card: &card,
            board: &board,
            comments: &[],
            mode: ChatMode::Execute,
            user_message: "do it",
            custom_instructions: "",
            auto_commit: false,
            auto_push: false,
            branch_mode: "current",
            card_files: &[],
        });
        assert!(prompt.contains("## Chat Mode: Execute"));
        assert!(prompt.contains("You may modify files and make code changes."));
    }

    // --- Tests that require a real DB (executions.get_last_session_id) ---

    fn db_setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let b = boards::create(
            &conn,
            &CreateBoard {
                name: "b".into(),
                description: "".into(),
                directory: "/tmp".into(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        let c = cards::create(
            &conn,
            &b.id,
            &CreateCard {
                title: "c".into(),
                description: None,
                tags: None,
                assignee: None,
            },
        )
        .unwrap();
        (conn, c.card.id)
    }

    #[test]
    fn get_last_session_id_returns_none_when_no_executions() {
        let (conn, card_id) = db_setup();
        let result = executions::get_last_session_id(&conn, &card_id).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn get_last_session_id_returns_latest_session() {
        let (conn, card_id) = db_setup();
        executions::create_execution(&conn, &card_id, "sess-first", ExecutionPhase::Plan).unwrap();
        executions::create_execution(&conn, &card_id, "sess-last", ExecutionPhase::Execute).unwrap();
        let result = executions::get_last_session_id(&conn, &card_id).unwrap();
        assert_eq!(result, Some("sess-last".to_string()));
    }
}
