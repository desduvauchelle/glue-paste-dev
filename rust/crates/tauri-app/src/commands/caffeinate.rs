/// Caffeinate commands — prevent system sleep while cards are running.
/// Uses a static Mutex<Option<Child>> to track the caffeinate process.
use tauri::State;
use std::sync::Mutex;
use std::process::{Child, Command};
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

static CAFFEINATE_PROC: Mutex<Option<Child>> = Mutex::new(None);

fn is_active() -> bool {
    if let Ok(guard) = CAFFEINATE_PROC.lock() {
        guard.is_some()
    } else {
        false
    }
}

fn start() {
    let mut guard = match CAFFEINATE_PROC.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.is_some() {
        return;
    }

    #[cfg(target_os = "macos")]
    let child = Command::new("caffeinate").arg("-i").spawn();

    #[cfg(not(target_os = "macos"))]
    let child: Result<Child, std::io::Error> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "caffeinate not supported on this platform",
    ));

    if let Ok(c) = child {
        *guard = Some(c);
    }
}

fn stop() {
    let mut guard = match CAFFEINATE_PROC.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

fn active_boards(conn: &rusqlite::Connection) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT b.id, b.name FROM boards b
             JOIN cards c ON c.board_id = b.id
             WHERE c.status IN ('queued', 'in-progress')
             ORDER BY b.name",
        )
        .map_err(map_err)?;
    let rows = stmt
        .query_map([], |r| Ok(serde_json::json!({ "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)? })))
        .map_err(map_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_err)?;
    Ok(rows)
}

#[tauri::command]
pub fn caffeinate_status(state: State<AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let boards = active_boards(&conn)?;
    Ok(serde_json::json!({ "active": is_active(), "activeBoards": boards }))
}

#[tauri::command]
pub fn caffeinate_start(_state: State<AppState>) -> Result<serde_json::Value, String> {
    start();
    Ok(serde_json::json!({ "active": is_active() }))
}

#[tauri::command]
pub fn caffeinate_stop(_state: State<AppState>) -> Result<serde_json::Value, String> {
    stop();
    Ok(serde_json::json!({ "active": false }))
}
