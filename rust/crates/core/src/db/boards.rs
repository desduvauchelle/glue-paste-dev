use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{Board, CreateBoard, UpdateBoard};
use crate::Result;

pub fn list(conn: &Connection) -> Result<Vec<Board>> {
    let mut stmt = conn.prepare("SELECT * FROM boards ORDER BY updated_at DESC")?;
    let rows = stmt
        .query_map([], row_to_board)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Board>> {
    let board = conn
        .query_row("SELECT * FROM boards WHERE id = ?", [id], row_to_board)
        .optional()?;
    Ok(board)
}

pub fn create(conn: &Connection, input: &CreateBoard) -> Result<Board> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let board = conn.query_row(
        "INSERT INTO boards (name, description, directory, session_id, color, slug, github_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *",
        params![
            input.name,
            input.description,
            input.directory,
            session_id,
            input.color,
            input.slug,
            input.github_url
        ],
        row_to_board,
    )?;
    Ok(board)
}

pub fn update(conn: &Connection, id: &str, input: &UpdateBoard) -> Result<Option<Board>> {
    let Some(current) = get(conn, id)? else {
        return Ok(None);
    };
    let name = input.name.clone().unwrap_or(current.name);
    let description = input.description.clone().unwrap_or(current.description);
    let directory = input.directory.clone().unwrap_or(current.directory);
    let color = match &input.color {
        Some(v) => v.clone(),
        None => current.color,
    };
    let scratchpad = input.scratchpad.clone().unwrap_or(current.scratchpad);
    let slug = match &input.slug {
        Some(v) => v.clone(),
        None => current.slug,
    };
    let github_url = match &input.github_url {
        Some(v) => v.clone(),
        None => current.github_url,
    };

    let board = conn.query_row(
        "UPDATE boards
            SET name = ?, description = ?, directory = ?, color = ?, scratchpad = ?, slug = ?, github_url = ?, updated_at = datetime('now')
            WHERE id = ?
            RETURNING *",
        params![name, description, directory, color, scratchpad, slug, github_url, id],
        row_to_board,
    )?;
    Ok(Some(board))
}

pub fn delete(conn: &Connection, id: &str) -> Result<bool> {
    let changes = conn.execute("DELETE FROM boards WHERE id = ?", [id])?;
    Ok(changes > 0)
}

fn row_to_board(row: &rusqlite::Row<'_>) -> rusqlite::Result<Board> {
    Ok(Board {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        directory: row.get("directory")?,
        session_id: row.get("session_id")?,
        color: row.get("color")?,
        scratchpad: row.get("scratchpad")?,
        slug: row.get("slug")?,
        github_url: row.get("github_url")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_memory;
    use crate::types::CreateBoard;

    fn sample() -> CreateBoard {
        CreateBoard {
            name: "Alpha".into(),
            description: "desc".into(),
            directory: "/tmp/alpha".into(),
            color: Some("#ff0000".into()),
            slug: Some("alpha".into()),
            github_url: None,
        }
    }

    #[test]
    fn create_then_get() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        assert_eq!(created.name, "Alpha");
        let fetched = get(&conn, &created.id).unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn list_orders_by_updated_at_desc() {
        let conn = open_memory().unwrap();
        let a = create(&conn, &sample()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let mut second = sample();
        second.name = "Beta".into();
        second.slug = Some("beta".into());
        let b = create(&conn, &second).unwrap();
        let list = list(&conn).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }

    #[test]
    fn update_changes_fields() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        let mut patch = UpdateBoard::default();
        patch.name = Some("Renamed".into());
        let updated = update(&conn, &created.id, &patch).unwrap().unwrap();
        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description, "desc");
    }

    #[test]
    fn delete_returns_true_then_false() {
        let conn = open_memory().unwrap();
        let created = create(&conn, &sample()).unwrap();
        assert!(delete(&conn, &created.id).unwrap());
        assert!(!delete(&conn, &created.id).unwrap());
    }
}
