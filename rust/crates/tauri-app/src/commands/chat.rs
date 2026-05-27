use std::sync::Arc;
use tauri::{AppHandle, State};
use serde::Deserialize;
use crate::state::AppState;
use crate::event_callbacks::AppEventCallbacks;
use glue_paste_dev_core::executor::chat::{self, ChatMode, ChatThinking, ChatOptions, ChatConfig};
use glue_paste_dev_core::db;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Deserialize)]
pub struct ChatStartArgs {
    pub message: String,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default = "default_thinking")]
    pub thinking: String,
}

fn default_mode() -> String { "plan".into() }
fn default_thinking() -> String { "smart".into() }

#[tauri::command]
pub async fn chat_start(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: String,
    args: ChatStartArgs,
) -> Result<(), String> {
    if chat::has_chat_process(&card_id) {
        return Err("Chat already in progress for this card".into());
    }
    if args.message.trim().is_empty() {
        return Err("Message is required".into());
    }

    // Fetch data from the shared DB before spawning, to avoid Send issues with MutexGuard.
    let (card, board, comments, config) = {
        let conn = state.db.lock().map_err(map_err)?;

        let card = db::cards::get_with_tags(&conn, &card_id)
            .map_err(map_err)?
            .ok_or_else(|| format!("Card not found: {card_id}"))?;

        let board = db::boards::get(&conn, &card.card.board_id)
            .map_err(map_err)?
            .ok_or_else(|| format!("Board not found: {}", card.card.board_id))?;

        let comments = db::comments::list_for_card(&conn, &card_id).unwrap_or_default();

        // Open a separate connection for the spawned task (AppState.db uses a single Mutex<Connection>
        // which is not Send across await boundaries; open_default gives a fresh connection).
        let config = ChatConfig {
            cli_provider: "claude".into(),
            model: String::new(),
            max_budget_usd: 0.0,
            cli_custom_command: String::new(),
            plan_thinking: "smart".into(),
            execute_thinking: "smart".into(),
            custom_instructions: String::new(),
            auto_commit: false,
            auto_push: false,
            branch_mode: "current".into(),
        };

        (card, board, comments, config)
    };

    let mode = if args.mode == "execute" { ChatMode::Execute } else { ChatMode::Plan };
    let thinking = if args.thinking == "basic" { ChatThinking::Basic } else { ChatThinking::Smart };
    let user_message = args.message;

    tokio::spawn(async move {
        // Open a fresh connection for the long-running async task.
        let conn = match db::connection::open_default() {
            Ok(c) => c,
            Err(e) => { eprintln!("chat_start: open_default failed: {e}"); return; }
        };
        let db_arc = Arc::new(std::sync::Mutex::new(conn));

        let opts = ChatOptions {
            card: &card,
            board: &board,
            comments: &comments,
            config: &config,
            mode,
            user_message,
            thinking,
            card_files: vec![],
        };

        let callbacks: Arc<dyn chat::ChatCallbacks> = Arc::new(AppEventCallbacks { app });
        let _ = chat::run_chat(db_arc, opts, callbacks).await;
    });

    Ok(())
}

#[tauri::command]
pub fn chat_stop(card_id: String) -> bool {
    chat::kill_chat_process(&card_id)
}
