use std::sync::Mutex;
use rusqlite::Connection;

pub struct AppState {
    pub db: Mutex<Connection>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        let conn = glue_paste_dev_core::db::connection::open_default()
            .map_err(|e| format!("failed to open DB: {e}"))?;
        Ok(Self { db: Mutex::new(conn) })
    }
}
