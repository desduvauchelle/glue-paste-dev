use std::{collections::HashMap, sync::Arc};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use glue_paste_dev_core::{
    executor::pty_runner::{create_execution_hub, open_card_pty_session},
    terminal::{PermissionMode, TerminalHub},
};

use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Lazily initialise or return the process-wide `TerminalHub`.
fn get_or_init_hub(state: &AppState, app: &AppHandle) -> Arc<TerminalHub> {
    state.terminal_hub.get_or_init(|| {
        let app_output = app.clone();
        let app_exited = app.clone();
        let app_idle = app.clone();
        let app_busy = app.clone();
        let app_perm = app.clone();

        let hub = create_execution_hub(
            PermissionMode::AutoUnlessWatching,
            12,
            // on_output
            Arc::new(move |card_id, chunk| {
                let _ = app_output.emit(
                    "terminal:output",
                    serde_json::json!({ "cardId": card_id, "chunk": chunk }),
                );
            }),
            // on_exit
            Arc::new(move |card_id, code| {
                let _ = app_exited.emit(
                    "terminal:exited",
                    serde_json::json!({ "cardId": card_id, "code": code }),
                );
            }),
            // on_idle
            Some(Arc::new(move |card_id| {
                let _ = app_idle.emit(
                    "terminal:idle",
                    serde_json::json!({ "cardId": card_id }),
                );
                let _ = app_idle.emit(
                    "terminal:session-state",
                    serde_json::json!({ "cardId": card_id, "state": "idle" }),
                );
            })),
            // on_busy
            Some(Arc::new(move |card_id| {
                let _ = app_busy.emit(
                    "terminal:session-state",
                    serde_json::json!({ "cardId": card_id, "state": "working" }),
                );
            })),
            // on_permission_pending
            Some(Arc::new(move |card_id, pending| {
                let _ = app_perm.emit(
                    "terminal:permission-pending",
                    serde_json::json!({ "cardId": card_id, "pending": pending }),
                );
            })),
        );

        Arc::new(hub)
    }).clone()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Open (or no-op if already running) the live terminal for a card.
#[tauri::command]
pub async fn terminal_open(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: String,
    cwd: String,
) -> Result<(), String> {
    let hub = get_or_init_hub(&state, &app);

    // Resolve a fresh env for the PTY child
    let env: HashMap<String, String> = std::env::vars().collect();

    open_card_pty_session(
        &hub,
        &card_id,
        &cwd,
        vec!["claude".to_string()],
        env,
        None,  // no pre-filled prompt; user drives input directly
        80,
        24,
    ).map_err(map_err)
}

/// Close (kill) the session for a card. Returns true if there was a session.
#[tauri::command]
pub fn terminal_close(
    state: State<'_, AppState>,
    _app: AppHandle,
    card_id: String,
) -> bool {
    let hub = match state.terminal_hub.get() {
        Some(h) => Arc::clone(h),
        None => return false,
    };
    let was_running = hub.is_running(&card_id);
    hub.close(&card_id);
    was_running
}

#[derive(Serialize)]
pub struct TerminalStatus {
    pub running: bool,
    pub scrollback: String,
}

/// Returns running state + scrollback buffer (for (re)attach).
#[tauri::command]
pub fn terminal_status(
    state: State<'_, AppState>,
    _app: AppHandle,
    card_id: String,
) -> TerminalStatus {
    match state.terminal_hub.get() {
        Some(hub) => TerminalStatus {
            running: hub.is_running(&card_id),
            scrollback: hub.get_scrollback(&card_id),
        },
        None => TerminalStatus {
            running: false,
            scrollback: String::new(),
        },
    }
}

/// Send raw input to the PTY (keystrokes / a prompt line).
#[tauri::command]
pub fn terminal_input(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: String,
    data: String,
) -> Result<(), String> {
    let hub = get_or_init_hub(&state, &app);
    hub.input(&card_id, &data);
    Ok(())
}

/// Resize the PTY window.
#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let hub = get_or_init_hub(&state, &app);
    hub.resize(&card_id, cols, rows);
    Ok(())
}

/// Send Ctrl-C to interrupt the current turn (session stays alive).
#[tauri::command]
pub fn terminal_interrupt(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: String,
) -> Result<(), String> {
    let hub = get_or_init_hub(&state, &app);
    hub.interrupt(&card_id);
    Ok(())
}

/// Kill the session (used when dragging to Done/ToDo/Queued).
///
/// Note: session_state DB update is handled by the Bun server layer in Phase 1/2.
/// In the pure-Rust path (Phase 6+), this will also update the DB.
#[tauri::command]
pub fn terminal_kill_session(
    state: State<'_, AppState>,
    _app: AppHandle,
    card_id: String,
) -> bool {
    let was_running = if let Some(hub) = state.terminal_hub.get() {
        let was = hub.is_running(&card_id);
        hub.close(&card_id);
        was
    } else {
        false
    };
    was_running
}
