//! PTY-based card runner — Rust port of `packages/core/src/executor/pty-runner.ts`.
//!
//! Runs a card's execution phase as a live interactive PTY session via `TerminalHub`.
//! The hub session IS the run — the dashboard Terminal tab attaches to the same card_id session.

use std::{collections::HashMap, sync::Arc};

use crate::terminal::{
    terminal_hub::{PermissionMode, TerminalHub, TerminalHubOptions, OpenOptions},
    PtySession, PtySessionOptions,
};

/// Build a `TerminalHub` for card execution, wired to the given callbacks.
///
/// - `on_output(card_id, chunk)` — stream PTY output to callers
/// - `on_exit(card_id, code)` — session exit
/// - `on_idle(card_id)` — turn complete (idle detected)
/// - `on_busy(card_id)` — session resumed from idle
/// - `on_permission_pending(card_id, pending)` — permission prompt appeared/cleared
pub fn create_execution_hub(
    permission_mode: PermissionMode,
    max_sessions: usize,
    on_output: Arc<dyn Fn(&str, &str) + Send + Sync>,
    on_exit: Arc<dyn Fn(&str, i32) + Send + Sync>,
    on_idle: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    on_busy: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    on_permission_pending: Option<Arc<dyn Fn(&str, bool) + Send + Sync>>,
) -> TerminalHub {
    TerminalHub::new(TerminalHubOptions {
        permission_mode,
        on_output,
        on_exit,
        on_idle,
        on_busy,
        on_permission_pending,
        grace_ms: None,
        watch_window_ms: None,
        initial_input_delay_ms: None,
        max_sessions: Some(max_sessions),
    })
}

/// Open a PTY session for `card_id` running the given `command` with optional `initial_input`.
///
/// Spawns a PTY child process and registers the session in the hub.
/// Returns `Err` if the PTY could not be spawned; in that case the hub entry is NOT created.
pub fn open_card_pty_session(
    hub: &TerminalHub,
    card_id: &str,
    cwd: &str,
    command: Vec<String>,
    env: HashMap<String, String>,
    initial_input: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Build the on_data/on_exit callbacks before spawning
    let callbacks = hub.make_session_callbacks(card_id);

    let session = Arc::new(PtySession::new(PtySessionOptions {
        command,
        cwd: cwd.to_string(),
        env,
        cols,
        rows,
        on_data: callbacks.on_data,
        on_exit: callbacks.on_exit,
    })?);

    let s_write = Arc::clone(&session);
    let s_resize = Arc::clone(&session);
    let s_kill = Arc::clone(&session);
    let s_scrollback = Arc::clone(&session);
    let s_running = Arc::clone(&session);

    hub.open(
        card_id,
        OpenOptions {
            cwd: cwd.to_string(),
            cols,
            rows,
            command: None, // command was consumed by PtySession::new
            initial_input,
        },
        Box::new(move |data: &str| s_write.write(data)),
        Box::new(move |cols: u16, rows: u16| s_resize.resize(cols, rows)),
        Box::new(move || s_kill.kill()),
        Box::new(move || s_scrollback.get_scrollback()),
        Box::new(move || s_running.is_running()),
    );

    Ok(())
}
