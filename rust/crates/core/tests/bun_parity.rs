use glue_paste_dev_core::db::{boards, cards, connection};
use glue_paste_dev_core::types::CreateBoard;

#[test]
fn rust_reads_bun_created_db() {
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/bun-created.db");
    // Copy to tempdir so we don't pollute the fixture with new pragmas
    let tmp = tempfile::tempdir().unwrap();
    let dest = tmp.path().join("copy.db");
    std::fs::copy(&fixture, &dest).unwrap();

    let conn = connection::open_at(&dest).expect("open bun-created db");
    let boards_list = boards::list(&conn).unwrap();
    assert!(!boards_list.is_empty(), "should have at least one board");

    let first = &boards_list[0];
    assert_eq!(first.name, "Fix");

    let (cards_list, _) = cards::list_for_board(&conn, &first.id, 20).unwrap();
    assert_eq!(cards_list.len(), 1);
    assert_eq!(cards_list[0].card.title, "Task1");
    assert_eq!(cards_list[0].tags, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn rust_created_db_reopens_cleanly() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("rust.db");
    {
        let conn = connection::open_at(&path).unwrap();
        boards::create(
            &conn,
            &CreateBoard {
                name: "R".into(),
                description: "".into(),
                directory: "/tmp".into(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
    }
    // Re-open: migrations must no-op
    let conn2 = connection::open_at(&path).unwrap();
    let list = boards::list(&conn2).unwrap();
    assert_eq!(list.len(), 1);
}
