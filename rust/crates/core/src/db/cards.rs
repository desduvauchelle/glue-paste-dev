use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Card, CardStatus, CardWithTags, CreateCard, UpdateCard};
use crate::Result;

pub fn list_for_board(conn: &Connection, board_id: &str, done_limit: i64) -> Result<(Vec<CardWithTags>, bool)> {
    let mut stmt = conn.prepare(
        "SELECT * FROM cards
         WHERE board_id = ? AND status != 'done'
         ORDER BY position ASC, created_at ASC",
    )?;
    let mut cards: Vec<Card> = stmt
        .query_map([board_id], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut done_stmt = conn.prepare(
        "SELECT * FROM cards
         WHERE board_id = ? AND status = 'done'
         ORDER BY updated_at DESC
         LIMIT ?",
    )?;
    let done: Vec<Card> = done_stmt
        .query_map(params![board_id, done_limit], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    cards.extend(done);

    let total_done: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE board_id = ? AND status = 'done'",
        [board_id],
        |r| r.get(0),
    )?;
    let done_has_more = total_done > done_limit;

    let with_tags = cards
        .into_iter()
        .map(|c| {
            let tags = tags_for_card(conn, &c.id).unwrap_or_default();
            CardWithTags { card: c, tags }
        })
        .collect();

    Ok((with_tags, done_has_more))
}

pub fn get_with_tags(conn: &Connection, id: &str) -> Result<Option<CardWithTags>> {
    let card = conn
        .query_row("SELECT * FROM cards WHERE id = ?", [id], row_to_card)
        .optional()?;
    match card {
        Some(c) => {
            let tags = tags_for_card(conn, &c.id)?;
            Ok(Some(CardWithTags { card: c, tags }))
        }
        None => Ok(None),
    }
}

pub fn create(conn: &Connection, board_id: &str, input: &CreateCard) -> Result<CardWithTags> {
    let next_position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM cards WHERE board_id = ? AND status = 'todo'",
        [board_id],
        |r| r.get(0),
    )?;

    let assignee = input.assignee.clone().unwrap_or(crate::types::Assignee::Ai);
    let assignee_str = match assignee {
        crate::types::Assignee::Ai => "ai",
        crate::types::Assignee::Human => "human",
    };

    let card = conn.query_row(
        "INSERT INTO cards (board_id, title, description, position, assignee)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *",
        params![
            board_id,
            input.title,
            input.description.clone().unwrap_or_default(),
            next_position,
            assignee_str
        ],
        row_to_card,
    )?;

    if let Some(tags) = &input.tags {
        for tag in tags {
            conn.execute(
                "INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)",
                params![card.id, tag],
            )?;
        }
    }

    let tags = tags_for_card(conn, &card.id)?;
    Ok(CardWithTags { card, tags })
}

pub fn update(conn: &Connection, id: &str, input: &UpdateCard) -> Result<Option<CardWithTags>> {
    let Some(current) = get_with_tags(conn, id)? else {
        return Ok(None);
    };
    let c = &current.card;

    let title = input.title.clone().unwrap_or_else(|| c.title.clone());
    let description = input.description.clone().unwrap_or_else(|| c.description.clone());
    let status = input.status.clone().unwrap_or_else(|| c.status.clone());
    let assignee = input.assignee.clone().unwrap_or_else(|| c.assignee.clone());

    let status_str = status_to_str(&status);
    let assignee_str = match assignee {
        crate::types::Assignee::Ai => "ai",
        crate::types::Assignee::Human => "human",
    };

    conn.execute(
        "UPDATE cards SET title = ?, description = ?, status = ?, assignee = ?, updated_at = datetime('now') WHERE id = ?",
        params![title, description, status_str, assignee_str, id],
    )?;

    if let Some(new_tags) = &input.tags {
        conn.execute("DELETE FROM card_tags WHERE card_id = ?", [id])?;
        for tag in new_tags {
            conn.execute(
                "INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)",
                params![id, tag],
            )?;
        }
    }

    get_with_tags(conn, id)
}

pub fn move_card(conn: &Connection, id: &str, status: CardStatus, position: i64) -> Result<Option<CardWithTags>> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE cards SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
        params![status_str, position, id],
    )?;
    get_with_tags(conn, id)
}

/// List all cards for a board with a given status, ordered by position then created_at.
pub fn list_by_status(conn: &Connection, board_id: &str, status: CardStatus) -> Result<Vec<CardWithTags>> {
    let status_str = status_to_str(&status);
    let mut stmt = conn.prepare(
        "SELECT * FROM cards WHERE board_id = ? AND status = ? ORDER BY position ASC, created_at ASC",
    )?;
    let cards: Vec<Card> = stmt
        .query_map(params![board_id, status_str], row_to_card)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let with_tags = cards
        .into_iter()
        .map(|c| {
            let tags = tags_for_card(conn, &c.id).unwrap_or_default();
            CardWithTags { card: c, tags }
        })
        .collect();
    Ok(with_tags)
}

pub fn set_status(conn: &Connection, id: &str, status: CardStatus) -> Result<()> {
    let status_str = status_to_str(&status);
    conn.execute(
        "UPDATE cards SET status = ?, updated_at = datetime('now') WHERE id = ?",
        params![status_str, id],
    )?;
    Ok(())
}

pub fn count_active(conn: &Connection) -> Result<i64> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cards WHERE status IN ('queued', 'in-progress')",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let n = conn.execute("DELETE FROM cards WHERE id = ?", [id])?;
    Ok(n > 0)
}

pub fn set_plan_summary(conn: &Connection, id: &str, summary: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET plan_summary = ?, updated_at = datetime('now') WHERE id = ?",
        params![summary, id],
    )?;
    Ok(())
}

pub fn set_completion_summary(conn: &Connection, id: &str, summary: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET completion_summary = ?, updated_at = datetime('now') WHERE id = ?",
        params![summary, id],
    )?;
    Ok(())
}

pub fn set_blocker(conn: &Connection, id: &str, blocker: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE cards SET blocker = ?, updated_at = datetime('now') WHERE id = ?",
        params![blocker, id],
    )?;
    Ok(())
}

pub fn clear_blocker(conn: &Connection, id: &str) -> Result<()> {
    set_blocker(conn, id, None)
}

fn tags_for_card(conn: &Connection, card_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag")?;
    let tags: Vec<String> = stmt
        .query_map([card_id], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tags)
}

fn status_to_str(s: &CardStatus) -> &'static str {
    match s {
        CardStatus::Todo => "todo",
        CardStatus::Queued => "queued",
        CardStatus::InProgress => "in-progress",
        CardStatus::Done => "done",
        CardStatus::Failed => "failed",
    }
}

fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<Card> {
    let status_str: String = row.get("status")?;
    let status = match status_str.as_str() {
        "todo" => CardStatus::Todo,
        "queued" => CardStatus::Queued,
        "in-progress" => CardStatus::InProgress,
        "done" => CardStatus::Done,
        "failed" => CardStatus::Failed,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown status: {other}").into(),
        )),
    };
    let assignee_str: String = row.get("assignee")?;
    let assignee = match assignee_str.as_str() {
        "ai" => crate::types::Assignee::Ai,
        "human" => crate::types::Assignee::Human,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown assignee: {other}").into(),
        )),
    };
    Ok(Card {
        id: row.get("id")?,
        board_id: row.get("board_id")?,
        title: row.get("title")?,
        description: row.get("description")?,
        status,
        position: row.get("position")?,
        blocking: row.get("blocking")?,
        plan_thinking: row.get("plan_thinking")?,
        execute_thinking: row.get("execute_thinking")?,
        auto_commit: row.get("auto_commit")?,
        auto_push: row.get("auto_push")?,
        assignee,
        cli_provider: row.get("cli_provider")?,
        cli_custom_command: row.get("cli_custom_command")?,
        branch_mode: row.get("branch_mode")?,
        branch_name: row.get("branch_name")?,
        plan_summary: row.get("plan_summary")?,
        completion_summary: row.get("completion_summary")?,
        blocker: row.get("blocker")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let board = boards::create(
            &conn,
            &CreateBoard {
                name: "B".into(),
                description: String::new(),
                directory: "/tmp".into(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        (conn, board.id)
    }

    #[test]
    fn create_assigns_next_position() {
        let (conn, board_id) = setup();
        let a = create(&conn, &board_id, &CreateCard { title: "a".into(), description: None, tags: None, assignee: None }).unwrap();
        let b = create(&conn, &board_id, &CreateCard { title: "b".into(), description: None, tags: None, assignee: None }).unwrap();
        assert_eq!(a.card.position, 0);
        assert_eq!(b.card.position, 1);
    }

    #[test]
    fn tags_round_trip() {
        let (conn, board_id) = setup();
        let card = create(
            &conn,
            &board_id,
            &CreateCard {
                title: "t".into(),
                description: None,
                tags: Some(vec!["x".into(), "y".into()]),
                assignee: None,
            },
        )
        .unwrap();
        assert_eq!(card.tags, vec!["x".to_string(), "y".to_string()]);
    }

    #[test]
    fn update_replaces_tags() {
        let (conn, board_id) = setup();
        let card = create(&conn, &board_id, &CreateCard { title: "t".into(), description: None, tags: Some(vec!["a".into()]), assignee: None }).unwrap();
        let mut patch = UpdateCard::default();
        patch.tags = Some(vec!["b".into(), "c".into()]);
        let updated = update(&conn, &card.card.id, &patch).unwrap().unwrap();
        assert_eq!(updated.tags, vec!["b".to_string(), "c".to_string()]);
    }

    #[test]
    fn move_card_changes_status_and_position() {
        let (conn, board_id) = setup();
        let card = create(&conn, &board_id, &CreateCard { title: "t".into(), description: None, tags: None, assignee: None }).unwrap();
        let moved = move_card(&conn, &card.card.id, CardStatus::Queued, 5).unwrap().unwrap();
        assert_eq!(moved.card.status, CardStatus::Queued);
        assert_eq!(moved.card.position, 5);
    }

    #[test]
    fn count_active_counts_queued_and_in_progress() {
        let (conn, board_id) = setup();
        let a = create(&conn, &board_id, &CreateCard { title: "a".into(), description: None, tags: None, assignee: None }).unwrap();
        let b = create(&conn, &board_id, &CreateCard { title: "b".into(), description: None, tags: None, assignee: None }).unwrap();
        let c = create(&conn, &board_id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        move_card(&conn, &a.card.id, CardStatus::Queued, 0).unwrap();
        move_card(&conn, &b.card.id, CardStatus::InProgress, 0).unwrap();
        move_card(&conn, &c.card.id, CardStatus::Done, 0).unwrap();
        assert_eq!(count_active(&conn).unwrap(), 2);
    }
}
