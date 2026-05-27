use tauri::State;
use glue_paste_dev_core::db::criteria;
use glue_paste_dev_core::types::{Criterion, CreateCriterion, UpdateCriterion};
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub fn criteria_list_for_card(state: State<AppState>, card_id: String) -> Result<Vec<Criterion>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    criteria::list_for_card(&conn, &card_id).map_err(map_err)
}

#[tauri::command]
pub fn criteria_add(state: State<AppState>, card_id: String, input: CreateCriterion) -> Result<Criterion, String> {
    let conn = state.db.lock().map_err(map_err)?;
    criteria::add(&conn, &card_id, &input).map_err(map_err)
}

#[tauri::command]
pub fn criteria_update(state: State<AppState>, id: String, input: UpdateCriterion) -> Result<Option<Criterion>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    criteria::update(&conn, &id, &input).map_err(map_err)
}

#[tauri::command]
pub fn criteria_remove(state: State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(map_err)?;
    criteria::remove(&conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn criteria_reorder(state: State<AppState>, card_id: String, ordered_ids: Vec<String>) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_err)?;
    criteria::reorder(&conn, &card_id, &ordered_ids).map_err(map_err)
}
