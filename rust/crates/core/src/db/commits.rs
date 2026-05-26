use rusqlite::{params, Connection};

use crate::types::CardCommit;
use crate::Result;

pub struct NewCommit<'a> {
    pub card_id: &'a str,
    pub execution_id: Option<&'a str>,
    pub sha: &'a str,
    pub message: &'a str,
    pub author_name: &'a str,
    pub author_email: &'a str,
    pub files_changed: Option<&'a str>,
}

pub fn record(conn: &Connection, c: &NewCommit) -> Result<CardCommit> {
    let row = conn.query_row(
        "INSERT INTO card_commits (card_id, execution_id, sha, message, author_name, author_email, files_changed)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
        params![c.card_id, c.execution_id, c.sha, c.message, c.author_name, c.author_email, c.files_changed],
        row_to_commit,
    )?;
    Ok(row)
}

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<CardCommit>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM card_commits WHERE card_id = ? ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_commit)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn row_to_commit(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardCommit> {
    Ok(CardCommit {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        execution_id: row.get("execution_id")?,
        sha: row.get("sha")?,
        message: row.get("message")?,
        author_name: row.get("author_name")?,
        author_email: row.get("author_email")?,
        files_changed: row.get("files_changed")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    #[test]
    fn record_then_list() {
        let conn = open_memory().unwrap();
        let b = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let c = cards::create(&conn, &b.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        record(&conn, &NewCommit {
            card_id: &c.card.id,
            execution_id: None,
            sha: "abc123",
            message: "wip",
            author_name: "Tester",
            author_email: "test@example.com",
            files_changed: Some("a.txt"),
        }).unwrap();
        let list = list_for_card(&conn, &c.card.id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].sha, "abc123");
    }
}
