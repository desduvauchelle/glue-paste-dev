use tauri::State;
use glue_paste_dev_core::db::cards;
use glue_paste_dev_core::types::{CardStatus, CardWithTags, CreateCard, UpdateCard};
use crate::state::AppState;
use serde::Serialize;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Serialize)]
pub struct ListCardsResult {
    pub cards: Vec<CardWithTags>,
    pub done_has_more: bool,
}

#[tauri::command]
pub fn cards_list_for_board(state: State<AppState>, board_id: String, done_limit: Option<i64>) -> Result<ListCardsResult, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let (cards, done_has_more) = cards::list_for_board(&conn, &board_id, done_limit.unwrap_or(20)).map_err(map_err)?;
    Ok(ListCardsResult { cards, done_has_more })
}

#[tauri::command]
pub fn cards_get_with_tags(state: State<AppState>, id: String) -> Result<Option<CardWithTags>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::get_with_tags(&conn, &id).map_err(map_err)
}

#[tauri::command]
pub fn cards_create(state: State<AppState>, board_id: String, input: CreateCard) -> Result<CardWithTags, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::create(&conn, &board_id, &input).map_err(map_err)
}

#[tauri::command]
pub fn cards_update(state: State<AppState>, id: String, input: UpdateCard) -> Result<Option<CardWithTags>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::update(&conn, &id, &input).map_err(map_err)
}

#[tauri::command]
pub fn cards_move(state: State<AppState>, id: String, status: CardStatus, position: i64) -> Result<Option<CardWithTags>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::move_card(&conn, &id, status, position).map_err(map_err)
}

#[tauri::command]
pub fn cards_delete(state: State<AppState>, id: String) -> Result<bool, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::delete(&conn, &id).map_err(map_err)
}
