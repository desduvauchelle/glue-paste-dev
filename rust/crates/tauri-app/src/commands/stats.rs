use tauri::State;
use glue_paste_dev_core::db::cards;
use serde::Serialize;
use std::collections::HashMap;
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Serialize)]
pub struct DonePerDay {
    pub date: String,
    pub count: i64,
}

/// Fills in zero-count entries for all days in the window.
fn fill_date_series(raw: Vec<(String, i64)>, days: i64, tz_offset_minutes: i64) -> Vec<DonePerDay> {
    let map: HashMap<String, i64> = raw.into_iter().collect();
    let mut result = Vec::new();
    // Compute local "now" by applying the tz offset
    let now_utc = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    // offset: positive means UTC-behind → local time is ahead of UTC
    let local_now_secs = now_utc - tz_offset_minutes * 60;
    for i in (0..days).rev() {
        let day_secs = local_now_secs - i * 86400;
        let _dt = std::time::UNIX_EPOCH + std::time::Duration::from_secs(day_secs as u64);
        // Format as YYYY-MM-DD using simple arithmetic
        let key = unix_to_date(day_secs);
        result.push(DonePerDay { date: key.clone(), count: *map.get(&key).unwrap_or(&0) });
    }
    result
}

fn unix_to_date(secs: i64) -> String {
    // Simple conversion without chrono to avoid dependency in tauri-app crate
    // Days since Unix epoch
    let days = secs / 86400;
    // Zeller's algorithm or similar
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

fn days_to_ymd(days: i64) -> (i64, i64, i64) {
    // Algorithm from http://howardhinnant.github.io/date_algorithms.html
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[tauri::command]
pub fn stats_board_counts(state: State<AppState>) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let rows = cards::count_by_status_all_boards(&conn).map_err(map_err)?;

    let statuses = ["todo", "queued", "in-progress", "done", "failed"];
    let mut result: HashMap<String, HashMap<String, i64>> = HashMap::new();

    for (board_id, status, count) in rows {
        let entry = result.entry(board_id).or_insert_with(|| {
            statuses.iter().map(|s| (s.to_string(), 0i64)).collect()
        });
        entry.insert(status, count);
    }

    // Ensure all boards have all status keys (already initialized above per-entry)
    Ok(serde_json::to_value(result).map_err(map_err)?)
}

#[tauri::command]
pub fn stats_done_per_day(state: State<AppState>, days: Option<i64>, tz_offset: Option<i64>) -> Result<Vec<DonePerDay>, String> {
    let days = days.unwrap_or(14).min(90);
    let tz_offset = tz_offset.unwrap_or(0);
    let conn = state.db.lock().map_err(map_err)?;
    let raw = cards::count_done_per_day(&conn, days, tz_offset).map_err(map_err)?;
    Ok(fill_date_series(raw, days, tz_offset))
}

#[tauri::command]
pub fn stats_done_per_day_by_board(state: State<AppState>, days: Option<i64>, tz_offset: Option<i64>) -> Result<serde_json::Value, String> {
    let days = days.unwrap_or(14).min(90);
    let tz_offset = tz_offset.unwrap_or(0);
    let conn = state.db.lock().map_err(map_err)?;
    let raw = cards::count_done_per_day_by_board(&conn, days, tz_offset).map_err(map_err)?;

    // Group by board_id
    let mut by_board: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (board_id, day, count) in raw {
        by_board.entry(board_id).or_default().push((day, count));
    }

    // Fill date series per board
    let mut result: HashMap<String, Vec<DonePerDay>> = HashMap::new();
    for (board_id, rows) in by_board {
        result.insert(board_id, fill_date_series(rows, days, tz_offset));
    }

    Ok(serde_json::to_value(result).map_err(map_err)?)
}
