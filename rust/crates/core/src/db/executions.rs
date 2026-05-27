use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Execution, ExecutionPhase, ExecutionStatus};
use crate::Result;

pub fn create_execution(
    conn: &Connection,
    card_id: &str,
    session_id: &str,
    phase: ExecutionPhase,
) -> Result<Execution> {
    let phase_str = phase_to_str(&phase);
    let execution = conn.query_row(
        "INSERT INTO executions (card_id, session_id, phase)
         VALUES (?, ?, ?)
         RETURNING *",
        params![card_id, session_id, phase_str],
        row_to_execution,
    )?;
    Ok(execution)
}

pub fn append_output(conn: &Connection, id: &str, chunk: &str) -> Result<()> {
    conn.execute(
        "UPDATE executions SET output = output || ? WHERE id = ?",
        params![chunk, id],
    )?;
    Ok(())
}

pub fn complete(
    conn: &Connection,
    id: &str,
    status: ExecutionStatus,
    exit_code: Option<i64>,
    cost_usd: f64,
    files_changed: Option<&str>,
) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE executions
            SET status = ?, exit_code = ?, cost_usd = ?, files_changed = ?,
                finished_at = datetime('now')
            WHERE id = ?",
        params![status_str, exit_code, cost_usd, files_changed, id],
    )?;
    Ok(())
}

pub fn update_pid(conn: &Connection, id: &str, pid: u32) -> Result<()> {
    conn.execute(
        "UPDATE executions SET pid = ? WHERE id = ?",
        rusqlite::params![pid as i64, id],
    )?;
    Ok(())
}

pub fn update_status(conn: &Connection, id: &str, status: ExecutionStatus, exit_code: Option<i64>) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE executions SET status = ?, exit_code = ? WHERE id = ?",
        rusqlite::params![status_str, exit_code, id],
    )?;
    Ok(())
}

pub fn update_cost(conn: &Connection, id: &str, cost_usd: f64) -> Result<()> {
    conn.execute(
        "UPDATE executions SET cost_usd = ? WHERE id = ?",
        rusqlite::params![cost_usd, id],
    )?;
    Ok(())
}

pub fn update_files_changed(conn: &Connection, id: &str, files_changed: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE executions SET files_changed = ? WHERE id = ?",
        rusqlite::params![files_changed, id],
    )?;
    Ok(())
}

pub fn finish(conn: &Connection, id: &str, status: ExecutionStatus, exit_code: Option<i64>, cost_usd: f64) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE executions SET status = ?, exit_code = ?, cost_usd = ?, finished_at = datetime('now') WHERE id = ?",
        rusqlite::params![status_str, exit_code, cost_usd, id],
    )?;
    Ok(())
}

pub fn cancel_running(conn: &Connection) -> Result<usize> {
    let n = conn.execute(
        "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE status = 'running'",
        [],
    )?;
    Ok(n)
}

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Execution>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM executions WHERE card_id = ? ORDER BY started_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_execution)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Execution>> {
    let ex = conn
        .query_row("SELECT * FROM executions WHERE id = ?", [id], row_to_execution)
        .optional()?;
    Ok(ex)
}

/// Returns the output of the most recently completed plan-phase execution for a card.
/// Used by the queue to skip re-planning when retrying after a failed execute phase.
pub fn get_completed_plan_output(conn: &Connection, card_id: &str) -> Result<Option<String>> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT output FROM executions \
             WHERE card_id = ? AND phase = 'plan' AND status = 'success' \
             ORDER BY finished_at DESC, rowid DESC LIMIT 1",
            [card_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row.flatten())
}

pub fn get_last_session_id(conn: &Connection, card_id: &str) -> Result<Option<String>> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT session_id FROM executions WHERE card_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
            [card_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(row.flatten())
}

fn phase_to_str(p: &ExecutionPhase) -> &'static str {
    match p {
        ExecutionPhase::Plan => "plan",
        ExecutionPhase::Execute => "execute",
    }
}

fn status_to_str(s: &ExecutionStatus) -> &'static str {
    match s {
        ExecutionStatus::Running => "running",
        ExecutionStatus::Success => "success",
        ExecutionStatus::Failed => "failed",
        ExecutionStatus::Cancelled => "cancelled",
    }
}

fn row_to_execution(row: &rusqlite::Row<'_>) -> rusqlite::Result<Execution> {
    let phase_str: String = row.get("phase")?;
    let phase = match phase_str.as_str() {
        "plan" => ExecutionPhase::Plan,
        "execute" => ExecutionPhase::Execute,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("unknown phase: {other}").into(),
        )),
    };
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "running" => ExecutionStatus::Running,
        "success" => ExecutionStatus::Success,
        "failed" => ExecutionStatus::Failed,
        "cancelled" => ExecutionStatus::Cancelled,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("unknown status: {other}").into(),
        )),
    };
    Ok(Execution {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        session_id: row.get("session_id")?,
        phase,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        status,
        output: row.get("output")?,
        cost_usd: row.get("cost_usd")?,
        exit_code: row.get("exit_code")?,
        retry_count: row.get("retry_count")?,
        pid: row.get("pid")?,
        files_changed: row.get("files_changed")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let b = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let c = cards::create(&conn, &b.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        (conn, c.card.id)
    }

    #[test]
    fn create_then_append_then_complete() {
        let (conn, card_id) = setup();
        let ex = create_execution(&conn, &card_id, "sess-1", ExecutionPhase::Plan).unwrap();
        append_output(&conn, &ex.id, "hello ").unwrap();
        append_output(&conn, &ex.id, "world").unwrap();
        complete(&conn, &ex.id, ExecutionStatus::Success, Some(0), 0.25, Some("a.txt\nb.txt")).unwrap();
        let fetched = get(&conn, &ex.id).unwrap().unwrap();
        assert_eq!(fetched.output, "hello world");
        assert_eq!(fetched.status, ExecutionStatus::Success);
        assert_eq!(fetched.exit_code, Some(0));
        assert!((fetched.cost_usd - 0.25).abs() < 1e-9);
    }

    #[test]
    fn get_last_session_id_returns_none_when_no_executions() {
        let (conn, card_id) = setup();
        let result = get_last_session_id(&conn, &card_id).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn get_last_session_id_returns_latest_session() {
        let (conn, card_id) = setup();
        create_execution(&conn, &card_id, "sess-old", ExecutionPhase::Plan).unwrap();
        // Brief sleep not needed — SQLite uses datetime('now') which may collide in fast tests,
        // but inserting two rows is enough to test ordering as long as IDs differ.
        create_execution(&conn, &card_id, "sess-new", ExecutionPhase::Execute).unwrap();
        let result = get_last_session_id(&conn, &card_id).unwrap();
        assert_eq!(result, Some("sess-new".to_string()));
    }

    #[test]
    fn cancel_running_only_affects_running() {
        let (conn, card_id) = setup();
        let a = create_execution(&conn, &card_id, "s", ExecutionPhase::Plan).unwrap();
        let b = create_execution(&conn, &card_id, "s", ExecutionPhase::Execute).unwrap();
        complete(&conn, &b.id, ExecutionStatus::Success, Some(0), 0.0, None).unwrap();
        let n = cancel_running(&conn).unwrap();
        assert_eq!(n, 1);
        let a2 = get(&conn, &a.id).unwrap().unwrap();
        assert_eq!(a2.status, ExecutionStatus::Cancelled);
        let b2 = get(&conn, &b.id).unwrap().unwrap();
        assert_eq!(b2.status, ExecutionStatus::Success);
    }
}
