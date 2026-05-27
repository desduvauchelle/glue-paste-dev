/// Config commands — raw DB read/write (no merge-semantics from Bun core).
/// Simplified: getGlobal reads the 'global' row, getForBoard reads the board-keyed row,
/// update writes fields. getMergedConfig (inheritance) is skipped — getForBoard returns
/// the board-specific row only (nulls = inherit from global on the frontend side).
use tauri::State;
use glue_paste_dev_core::types::Config;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

fn row_to_config(row: &rusqlite::Row<'_>) -> rusqlite::Result<Config> {
    Ok(Config {
        key: row.get("key")?,
        cli_provider: row.get("cli_provider")?,
        cli_custom_command: row.get("cli_custom_command")?,
        model: row.get("model")?,
        max_budget_usd: row.get("max_budget_usd")?,
        plan_mode: row.get("plan_mode")?,
        thinking_level: row.get("thinking_level")?,
        custom_tags: row.get("custom_tags")?,
        custom_instructions: row.get("custom_instructions")?,
        plan_thinking: row.get("plan_thinking")?,
        execute_thinking: row.get("execute_thinking")?,
        auto_commit: row.get("auto_commit")?,
        plan_model: row.get("plan_model")?,
        execute_model: row.get("execute_model")?,
        auto_push: row.get("auto_push")?,
        branch_mode: row.get("branch_mode")?,
        branch_name: row.get("branch_name")?,
        max_concurrent_cards: row.get("max_concurrent_cards")?,
        terminal_permission_mode: row.get("terminal_permission_mode")?,
    })
}

fn get_config_row(conn: &rusqlite::Connection, key: &str) -> Result<Option<Config>, String> {
    conn.query_row(
        "SELECT * FROM config WHERE key = ?",
        [key],
        row_to_config,
    )
    .optional()
    .map_err(map_err)
}

use rusqlite::OptionalExtension;

fn ensure_config_row(conn: &rusqlite::Connection, key: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO config (key) VALUES (?)",
        [key],
    )
    .map(|_| ())
    .map_err(map_err)
}

#[tauri::command]
pub fn config_get_global(state: State<AppState>) -> Result<Option<Config>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    get_config_row(&conn, "global")
}

#[tauri::command]
pub fn config_get_for_board(state: State<AppState>, board_id: String) -> Result<Option<Config>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    get_config_row(&conn, &board_id)
}

#[tauri::command]
pub fn config_update_global(state: State<AppState>, input: serde_json::Value) -> Result<Option<Config>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    ensure_config_row(&conn, "global")?;
    apply_config_update(&conn, "global", &input)?;
    get_config_row(&conn, "global")
}

#[tauri::command]
pub fn config_update_for_board(state: State<AppState>, board_id: String, input: serde_json::Value) -> Result<Option<Config>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    ensure_config_row(&conn, &board_id)?;
    apply_config_update(&conn, &board_id, &input)?;
    get_config_row(&conn, &board_id)
}

fn apply_config_update(conn: &rusqlite::Connection, key: &str, input: &serde_json::Value) -> Result<(), String> {
    let obj = match input.as_object() {
        Some(o) => o,
        None => return Err("input must be an object".to_string()),
    };

    // Build a dynamic UPDATE statement for only the provided fields
    let allowed = [
        "cli_provider", "cli_custom_command", "model", "max_budget_usd",
        "plan_mode", "thinking_level", "custom_tags", "custom_instructions",
        "plan_thinking", "execute_thinking", "auto_commit", "plan_model",
        "execute_model", "auto_push", "branch_mode", "branch_name",
        "max_concurrent_cards", "terminal_permission_mode",
    ];

    // Map camelCase frontend keys to snake_case DB column names
    let field_map = [
        ("cliProvider", "cli_provider"),
        ("cliCustomCommand", "cli_custom_command"),
        ("maxBudgetUsd", "max_budget_usd"),
        ("planMode", "plan_mode"),
        ("thinkingLevel", "thinking_level"),
        ("customTags", "custom_tags"),
        ("customInstructions", "custom_instructions"),
        ("planThinking", "plan_thinking"),
        ("executeThinking", "execute_thinking"),
        ("autoCommit", "auto_commit"),
        ("planModel", "plan_model"),
        ("executeModel", "execute_model"),
        ("autoPush", "auto_push"),
        ("branchMode", "branch_mode"),
        ("branchName", "branch_name"),
        ("maxConcurrentCards", "max_concurrent_cards"),
        ("terminalPermissionMode", "terminal_permission_mode"),
    ];

    let mut sets: Vec<String> = Vec::new();
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    for (json_key, value) in obj {
        // Try direct snake_case match first
        let col = if allowed.contains(&json_key.as_str()) {
            json_key.as_str()
        } else {
            // Try camelCase→snake_case mapping
            match field_map.iter().find(|(k, _)| k == &json_key.as_str()) {
                Some((_, col)) => col,
                None => continue, // unknown field, skip
            }
        };

        sets.push(format!("{} = ?", col));
        let val = json_to_rusqlite(value);
        params.push(val);
    }

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE config SET {} WHERE key = ?", sets.join(", "));
    params.push(rusqlite::types::Value::Text(key.to_string()));

    let mut stmt = conn.prepare(&sql).map_err(map_err)?;
    stmt.execute(rusqlite::params_from_iter(params.iter())).map_err(map_err)?;
    Ok(())
}

fn json_to_rusqlite(v: &serde_json::Value) -> rusqlite::types::Value {
    match v {
        serde_json::Value::Null => rusqlite::types::Value::Null,
        serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        serde_json::Value::Array(_) => {
            rusqlite::types::Value::Text(v.to_string())
        }
        serde_json::Value::Object(_) => {
            rusqlite::types::Value::Text(v.to_string())
        }
    }
}
