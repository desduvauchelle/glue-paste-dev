use rusqlite::{params, Connection};

use crate::types::{Comment, CommentAuthor, CreateComment};
use crate::Result;

pub fn list_for_card(conn: &Connection, card_id: &str) -> Result<Vec<Comment>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM comments WHERE card_id = ? ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([card_id], row_to_comment)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create(conn: &Connection, card_id: &str, input: &CreateComment) -> Result<Comment> {
    let author = author_to_str(&input.author);
    let comment = conn.query_row(
        "INSERT INTO comments (card_id, author, content, execution_id)
         VALUES (?, ?, ?, ?)
         RETURNING *",
        params![card_id, author, input.content, input.execution_id],
        row_to_comment,
    )?;
    Ok(comment)
}

/// Convenience: creates a System-authored comment tied to an execution.
pub fn add_system_comment(conn: &Connection, card_id: &str, execution_id: &str, content: &str) -> Result<Comment> {
    create(conn, card_id, &CreateComment {
        author: CommentAuthor::System,
        content: content.to_string(),
        execution_id: Some(execution_id.to_string()),
    })
}

pub fn clear_for_card(conn: &Connection, card_id: &str) -> Result<usize> {
    let n = conn.execute("DELETE FROM comments WHERE card_id = ?", [card_id])?;
    Ok(n)
}

fn author_to_str(a: &CommentAuthor) -> &'static str {
    match a {
        CommentAuthor::User => "user",
        CommentAuthor::System => "system",
        CommentAuthor::Ai => "ai",
    }
}

fn row_to_comment(row: &rusqlite::Row<'_>) -> rusqlite::Result<Comment> {
    let author_str: String = row.get("author")?;
    let author = match author_str.as_str() {
        "user" => CommentAuthor::User,
        "system" => CommentAuthor::System,
        "ai" => CommentAuthor::Ai,
        other => return Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            format!("unknown author: {other}").into(),
        )),
    };
    Ok(Comment {
        id: row.get("id")?,
        card_id: row.get("card_id")?,
        author,
        content: row.get("content")?,
        execution_id: row.get("execution_id")?,
        created_at: row.get("created_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{CreateBoard, CreateCard};

    fn setup() -> (rusqlite::Connection, String) {
        let conn = open_memory().unwrap();
        let board = boards::create(&conn, &CreateBoard {
            name: "b".into(), description: "".into(), directory: "/tmp".into(),
            color: None, slug: None, github_url: None,
        }).unwrap();
        let card = cards::create(&conn, &board.id, &CreateCard { title: "c".into(), description: None, tags: None, assignee: None }).unwrap();
        (conn, card.card.id)
    }

    #[test]
    fn create_then_list() {
        let (conn, card_id) = setup();
        create(&conn, &card_id, &CreateComment {
            author: CommentAuthor::User,
            content: "hi".into(),
            execution_id: None,
        }).unwrap();
        let list = list_for_card(&conn, &card_id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "hi");
    }

    #[test]
    fn clear_removes_all() {
        let (conn, card_id) = setup();
        for i in 0..3 {
            create(&conn, &card_id, &CreateComment {
                author: CommentAuthor::User,
                content: format!("c{i}"),
                execution_id: None,
            }).unwrap();
        }
        let removed = clear_for_card(&conn, &card_id).unwrap();
        assert_eq!(removed, 3);
        assert_eq!(list_for_card(&conn, &card_id).unwrap().len(), 0);
    }
}
