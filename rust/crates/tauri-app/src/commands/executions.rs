use tauri::State;
use glue_paste_dev_core::db::executions;
use glue_paste_dev_core::types::Execution;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub fn executions_list_for_card(state: State<AppState>, card_id: String) -> Result<Vec<Execution>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    executions::list_for_card(&conn, &card_id).map_err(map_err)
}

#[tauri::command]
pub fn executions_get(state: State<AppState>, id: String) -> Result<Option<Execution>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    executions::get(&conn, &id).map_err(map_err)
}
