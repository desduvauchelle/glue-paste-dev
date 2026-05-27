use tauri::State;
use glue_paste_dev_core::db::cards;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

const DEFAULT_TAGS: &[&str] = &["UX", "design", "backend", "logic"];

#[tauri::command]
pub fn tags_defaults(state: State<AppState>) -> Result<Vec<String>, String> {
    // Read custom_tags from global config row
    let conn = state.db.lock().map_err(map_err)?;
    let custom_tags_raw: Option<String> = conn
        .query_row(
            "SELECT custom_tags FROM config WHERE key = 'global'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(None);

    let mut tags: Vec<String> = DEFAULT_TAGS.iter().map(|s| s.to_string()).collect();

    if let Some(raw) = custom_tags_raw {
        if let Ok(custom) = serde_json::from_str::<Vec<String>>(&raw) {
            tags.extend(custom);
        }
    }

    // Deduplicate preserving order
    let mut seen = std::collections::HashSet::new();
    let result = tags.into_iter().filter(|t| seen.insert(t.clone())).collect();
    Ok(result)
}

#[tauri::command]
pub fn tags_for_board(state: State<AppState>, board_id: String) -> Result<Vec<String>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    cards::distinct_tags(&conn, &board_id).map_err(map_err)
}
