use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{CreateCriterion, Criterion, CriterionSource, CriterionStatus, UpdateCriterion};
use crate::Result;

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Criterion>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM card_criteria WHERE card_id = ? ORDER BY position ASC, created_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_criterion)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn add(conn: &Connection, card_id: &str, input: &CreateCriterion) -> Result<Criterion> {
    let next_pos: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM card_criteria WHERE card_id = ?",
        [card_id],
        |r| r.get(0),
    )?;
    let source = source_to_str(&input.source);
    let c = conn.query_row(
        "INSERT INTO card_criteria (card_id, text, source, position)
         VALUES (?, ?, ?, ?)
         RETURNING *",
        params![card_id, input.text, source, next_pos],
        row_to_criterion,
    )?;
    Ok(c)
}

pub fn update(conn: &Connection, id: &str, input: &UpdateCriterion) -> Result<Option<Criterion>> {
    let Some(current) = get(conn, id)? else { return Ok(None); };
    let text = input.text.clone().unwrap_or(current.text);
    let status = input.status.clone().unwrap_or(current.status);
    let evidence = match &input.evidence {
        Some(v) => v.clone(),
        None => current.evidence,
    };
    let status_str = status_to_str(&status);
    let row = conn.query_row(
        "UPDATE card_criteria
            SET text = ?, status = ?, evidence = ?, updated_at = datetime('now')
            WHERE id = ?
            RETURNING *",
        params![text, status_str, evidence, id],
        row_to_criterion,
    )?;
    Ok(Some(row))
}

pub fn remove(conn: &Connection, id: &str) -> Result<bool> {
    let n = conn.execute("DELETE FROM card_criteria WHERE id = ?", [id])?;
    Ok(n > 0)
}

pub fn reorder(conn: &Connection, card_id: &str, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE card_criteria SET position = ?, updated_at = datetime('now')
             WHERE id = ? AND card_id = ?",
            params![i as i64, id, card_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn clear_for_card(conn: &Connection, card_id: &str) -> Result<usize> {
    let n = conn.execute("DELETE FROM card_criteria WHERE card_id = ?", [card_id])?;
    Ok(n)
}

/// Seeds criteria from a plan report. Skips criteria that already exist (by text match).
/// Used after plan phase: adds each criterion text as an AI-sourced criterion.
pub fn seed_criteria(conn: &Connection, card_id: &str, texts: &[String]) -> Result<Vec<Criterion>> {
    let mut out = Vec::new();
    for text in texts {
        let criterion = add(conn, card_id, &CreateCriterion {
            text: text.clone(),
            source: CriterionSource::Ai,
        })?;
        out.push(criterion);
    }
    Ok(out)
}

/// Sets the result of a criterion (status, evidence, execution_id) after execute phase.
pub fn set_criterion_result(
    conn: &Connection,
    id: &str,
    status: &str,
    evidence: &str,
    execution_id: &str,
) -> Result<()> {
    let status_val = match status {
        "pass" => CriterionStatus::Pass,
        "fail" => CriterionStatus::Fail,
        _ => CriterionStatus::Pending,
    };
    let status_str = status_to_str(&status_val);
    conn.execute(
        "UPDATE card_criteria SET status = ?, evidence = ?, execution_id = ?, updated_at = datetime('now') WHERE id = ?",
        rusqlite::params![status_str, evidence, execution_id, id],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Criterion>> {
    let c = conn
        .query_row("SELECT * FROM card_criteria WHERE id = ?", [id], row_to_criterion)
        .optional()?;
    Ok(c)
}

fn status_to_str(s: &CriterionStatus) -> &'static str {
    match s {
        CriterionStatus::Pending => "pending",
        CriterionStatus::Pass => "pass",
        CriterionStatus::Fail => "fail",
    }
}

fn source_to_str(s: &CriterionSource) -> &'static str {
    match s {
        CriterionSource::Ai => "ai",
        CriterionSource::User => "user",
    }
}

fn row_to_criterion(row: &rusqlite::Row<'_>) -> rusqlite::Result<Criterion> {
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "pending" => CriterionStatus::Pending,
        "pass" => CriterionStatus::Pass,
        "fail" => CriterionStatus::Fail,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("status: {other}").into(),
        )),
    };
    let source_str: String = row.get("source")?;
    let source = match source_str.as_str() {
        "ai" => CriterionSource::Ai,
        "user" => CriterionSource::User,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0, rusqlite::types::Type::Text, format!("source: {other}").into(),
        )),
    };
    Ok(Criterion {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        text: row.get("text")?,
        status,
        source,
        evidence: row.get("evidence")?,
        execution_id: row.get("execution_id")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
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
    fn add_assigns_position() {
        let (conn, card_id) = setup();
        let a = add(&conn, &card_id, &CreateCriterion { text: "a".into(), source: CriterionSource::User }).unwrap();
        let b = add(&conn, &card_id, &CreateCriterion { text: "b".into(), source: CriterionSource::Ai }).unwrap();
        assert_eq!(a.position, 0);
        assert_eq!(b.position, 1);
    }

    #[test]
    fn reorder_updates_positions() {
        let (conn, card_id) = setup();
        let a = add(&conn, &card_id, &CreateCriterion { text: "a".into(), source: CriterionSource::User }).unwrap();
        let b = add(&conn, &card_id, &CreateCriterion { text: "b".into(), source: CriterionSource::User }).unwrap();
        reorder(&conn, &card_id, &[b.id.clone(), a.id.clone()]).unwrap();
        let list = list_for_card(&conn, &card_id).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }
}
