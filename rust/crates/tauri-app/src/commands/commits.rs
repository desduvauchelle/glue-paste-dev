use tauri::State;
use glue_paste_dev_core::db::commits;
use glue_paste_dev_core::types::CardCommit;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub fn commits_list_for_card(state: State<AppState>, card_id: String) -> Result<Vec<CardCommit>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    commits::list_for_card(&conn, &card_id).map_err(map_err)
}
