use tauri::State;
use glue_paste_dev_core::db::boards;
use glue_paste_dev_core::types::{Board, CreateBoard, UpdateBoard};
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub fn boards_list(state: State<AppState>) -> Result<Vec<Board>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    boards::list(&conn).map_err(map_err)
}

#[tauri::command]
pub fn boards_get(state: State<AppState>, id: String) -> Result<Option<Board>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    boards::get(&conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn boards_create(state: State<AppState>, input: CreateBoard) -> Result<Board, String> {
    let conn = state.db.lock().map_err(map_err)?;
    boards::create(&conn, &input).map_err(map_err)
}

#[tauri::command]
pub fn boards_update(state: State<AppState>, id: String, input: UpdateBoard) -> Result<Option<Board>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    boards::update(&conn, &id, &input).map_err(map_err)
}

#[tauri::command]
pub fn boards_delete(state: State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(map_err)?;
    boards::delete(&conn, &id).map_err(map_err)
}
