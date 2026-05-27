use tauri::State;
use glue_paste_dev_core::db::comments;
use glue_paste_dev_core::types::{Comment, CreateComment};
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub fn comments_list_for_card(state: State<AppState>, card_id: String) -> Result<Vec<Comment>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    comments::list_for_card(&conn, &card_id).map_err(map_err)
}

#[tauri::command]
pub fn comments_create(state: State<AppState>, card_id: String, input: CreateComment) -> Result<Comment, String> {
    let conn = state.db.lock().map_err(map_err)?;
    comments::create(&conn, &card_id, &input).map_err(map_err)
}

#[tauri::command]
pub fn comments_clear(state: State<AppState>, card_id: String) -> Result<usize, String> {
    let conn = state.db.lock().map_err(map_err)?;
    comments::clear_for_card(&conn, &card_id).map_err(map_err)
}
