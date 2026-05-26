use rusqlite::Connection;
use std::path::{Path, PathBuf};

use crate::Result;

const DEFAULT_DIR: &str = ".glue-paste-dev";
const DEFAULT_FILE: &str = "glue-paste-dev.db";

pub fn default_db_path() -> PathBuf {
    let home = dirs::home_dir().expect("home dir resolvable");
    home.join(DEFAULT_DIR).join(DEFAULT_FILE)
}

pub fn open_at(path: impl AsRef<Path>) -> Result<Connection> {
    if let Some(parent) = path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path.as_ref())?;
    apply_pragmas(&conn)?;
    crate::db::schema::init(&conn)?;
    Ok(conn)
}

pub fn open_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    apply_pragmas(&conn)?;
    crate::db::schema::init(&conn)?;
    Ok(conn)
}

pub fn open_default() -> Result<Connection> {
    open_at(default_db_path())
}

pub fn wal_checkpoint(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE)")?;
    Ok(())
}

fn apply_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA cache_size = -2000;
         PRAGMA mmap_size = 64000000;",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_memory_applies_pragmas() {
        let conn = open_memory().expect("open");
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1, "foreign keys must be ON");
    }

    #[test]
    fn open_at_creates_parent_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("nested/dir/test.db");
        let _conn = open_at(&path).expect("open");
        assert!(path.exists());
    }
}
