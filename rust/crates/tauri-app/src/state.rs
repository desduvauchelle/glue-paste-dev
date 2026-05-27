use std::sync::{Mutex, OnceLock, Arc};
use rusqlite::Connection;
use tauri::AppHandle;
use glue_paste_dev_core::terminal::TerminalHub;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_handle: OnceLock<AppHandle>,
    /// Lazily initialised process-wide terminal hub.
    pub terminal_hub: OnceLock<Arc<TerminalHub>>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        let conn = glue_paste_dev_core::db::connection::open_default()
            .map_err(|e| format!("failed to open DB: {e}"))?;
        Ok(Self {
            db: Mutex::new(conn),
            app_handle: OnceLock::new(),
            terminal_hub: OnceLock::new(),
        })
    }
}
