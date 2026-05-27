use std::sync::{Arc, Mutex};

use tauri::{AppHandle, State};

use crate::event_callbacks::AppEventCallbacks;
use crate::state::AppState;
use glue_paste_dev_core::executor::queue;
use glue_paste_dev_core::executor::runner::RunnerConfig;

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Build a hardcoded RunnerConfig.
/// Phase 4.7 follow-up: read from config DB table and apply per-card overrides.
fn build_runner_config() -> RunnerConfig {
    RunnerConfig {
        cli_provider: "claude".to_string(),
        model: String::new(),
        max_budget_usd: 0.0,
        cli_custom_command: String::new(),
        plan_thinking: "smart".to_string(),
        execute_thinking: "smart".to_string(),
        custom_instructions: String::new(),
        auto_commit: false,
        auto_push: false,
        branch_mode: "current".to_string(),
        branch_name: None,
    }
}

#[tauri::command]
pub async fn queue_start(
    _state: State<'_, AppState>,
    board_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let config = build_runner_config();

    tokio::spawn(async move {
        let conn = match glue_paste_dev_core::db::connection::open_default() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[queue_start] open_default failed: {e}");
                return;
            }
        };
        let db = Arc::new(Mutex::new(conn));
        let callbacks: Arc<dyn queue::QueueCallbacks> =
            Arc::new(AppEventCallbacks { app });

        if let Err(e) = queue::start_queue(db, board_id, config, callbacks).await {
            eprintln!("[queue_start] error: {e}");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn queue_stop(_state: State<'_, AppState>, board_id: String) -> bool {
    queue::stop_queue(&board_id)
}

#[tauri::command]
pub fn queue_pause(_state: State<'_, AppState>, board_id: String) -> bool {
    queue::pause_queue(&board_id)
}

#[tauri::command]
pub fn queue_resume(_state: State<'_, AppState>, board_id: String) -> bool {
    queue::resume_queue(&board_id)
}

#[tauri::command]
pub fn queue_get_state(
    _state: State<'_, AppState>,
    board_id: String,
) -> Option<QueueStatePayload> {
    queue::get_queue_state(&board_id).map(|s| QueueStatePayload {
        board_id: s.board_id,
        is_running: s.is_running,
        is_paused: s.is_paused,
        queue: s.queue,
        active: s.active,
        current: s.current,
    })
}

/// Serializable snapshot of QueueState for IPC (QueueState itself is not Serialize).
#[derive(serde::Serialize)]
pub struct QueueStatePayload {
    #[serde(rename = "boardId")]
    pub board_id: String,
    #[serde(rename = "isRunning")]
    pub is_running: bool,
    #[serde(rename = "isPaused")]
    pub is_paused: bool,
    pub queue: Vec<String>,
    pub active: Vec<String>,
    pub current: Option<String>,
}

#[tauri::command]
pub async fn card_execute_single(
    _state: State<'_, AppState>,
    card_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let config = build_runner_config();

    tokio::spawn(async move {
        let conn = match glue_paste_dev_core::db::connection::open_default() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[card_execute_single] open_default failed: {e}");
                return;
            }
        };
        let db = Arc::new(Mutex::new(conn));
        let callbacks: Arc<dyn queue::QueueCallbacks> =
            Arc::new(AppEventCallbacks { app });

        if let Err(e) = queue::execute_single_card(db, card_id, config, callbacks).await {
            eprintln!("[card_execute_single] error: {e}");
        }
    });

    Ok(())
}

#[tauri::command]
pub fn card_stop(_state: State<'_, AppState>, card_id: String) -> Result<bool, String> {
    let db = Arc::new(Mutex::new(
        glue_paste_dev_core::db::connection::open_default().map_err(map_err)?,
    ));
    Ok(queue::stop_card(&db, &card_id))
}
