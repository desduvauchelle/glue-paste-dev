/// File commands — browse board directory, manage card attachments.
/// Upload (multipart) stays on HTTP; everything else is wired here.
use tauri::State;
use glue_paste_dev_core::db::boards;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use crate::state::AppState;

fn map_err(e: impl std::fmt::Display) -> String { e.to_string() }

const IGNORED: &[&str] = &[
    ".git", "node_modules", ".next", "dist", "build", "__pycache__",
    ".venv", ".DS_Store", ".glue-paste",
];

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub path: String,
}

fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name)
}

fn rel(root: &Path, full: &Path) -> String {
    full.strip_prefix(root)
        .unwrap_or(full)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_valid_card_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[tauri::command]
pub fn files_browse(state: State<AppState>, board_id: String, path: Option<String>) -> Result<Vec<FileEntry>, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let board = boards::get(&conn, &board_id)
        .map_err(map_err)?
        .ok_or_else(|| "Board not found".to_string())?;

    let root = PathBuf::from(&board.directory).canonicalize().map_err(map_err)?;
    let sub = path.unwrap_or_default();
    let target = root.join(&sub).canonicalize().unwrap_or_else(|_| root.join(&sub));

    // Prevent directory traversal
    if target != root && !target.starts_with(&root) {
        return Err("Invalid path".to_string());
    }

    let entries = fs::read_dir(&target).map_err(|_| "Cannot read directory".to_string())?;
    let mut result: Vec<FileEntry> = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored(&name) { continue; }
        if let Ok(meta) = entry.metadata() {
            let entry_type = if meta.is_dir() { "directory" } else { "file" };
            let full_path = entry.path();
            result.push(FileEntry {
                name,
                entry_type: entry_type.to_string(),
                path: rel(&root, &full_path),
            });
        }
    }

    result.sort_by(|a, b| {
        if a.entry_type != b.entry_type {
            if a.entry_type == "directory" { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(result)
}

fn walk_tree(dir: &Path, root: &Path, entries: &mut Vec<FileEntry>, depth: usize, max_files: usize) -> bool {
    if depth > 20 || entries.len() >= max_files {
        return true; // truncated
    }
    let read = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return false,
    };
    for entry in read.flatten() {
        if entries.len() >= max_files {
            return true;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if is_ignored(&name) { continue; }
        if let Ok(meta) = entry.metadata() {
            let is_dir = meta.is_dir();
            let full = entry.path();
            entries.push(FileEntry {
                name,
                entry_type: if is_dir { "directory" } else { "file" }.to_string(),
                path: rel(root, &full),
            });
            if is_dir {
                if walk_tree(&full, root, entries, depth + 1, max_files) {
                    return true;
                }
            }
        }
    }
    false
}

#[tauri::command]
pub fn files_tree(state: State<AppState>, board_id: String) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().map_err(map_err)?;
    let board = boards::get(&conn, &board_id)
        .map_err(map_err)?
        .ok_or_else(|| "Board not found".to_string())?;

    let root = PathBuf::from(&board.directory);
    let mut entries: Vec<FileEntry> = Vec::new();
    let truncated = walk_tree(&root, &root, &mut entries, 0, 10000);

    Ok(serde_json::json!({ "entries": entries, "truncated": truncated }))
}

#[tauri::command]
pub fn attachments_list(state: State<AppState>, board_id: String, card_id: String) -> Result<Vec<String>, String> {
    if !is_valid_card_id(&card_id) {
        return Err("Invalid card ID".to_string());
    }
    let conn = state.db.lock().map_err(map_err)?;
    let board = boards::get(&conn, &board_id)
        .map_err(map_err)?
        .ok_or_else(|| "Board not found".to_string())?;

    let root = PathBuf::from(&board.directory);
    let attachments_dir = root.join(".glue-paste").join("attachments").join(&card_id);

    match fs::read_dir(&attachments_dir) {
        Ok(entries) => {
            let files: Vec<String> = entries
                .flatten()
                .map(|e| rel(&root, &e.path()))
                .collect();
            Ok(files)
        }
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn attachments_delete_file(
    state: State<AppState>,
    board_id: String,
    card_id: String,
    filename: String,
) -> Result<serde_json::Value, String> {
    if !is_valid_card_id(&card_id) {
        return Err("Invalid card ID".to_string());
    }
    let safe_name = sanitize_filename(&filename);
    if safe_name.is_empty() {
        return Err("Invalid filename".to_string());
    }

    let conn = state.db.lock().map_err(map_err)?;
    let board = boards::get(&conn, &board_id)
        .map_err(map_err)?
        .ok_or_else(|| "Board not found".to_string())?;

    let file_path = PathBuf::from(&board.directory)
        .join(".glue-paste")
        .join("attachments")
        .join(&card_id)
        .join(&safe_name);

    let _ = fs::remove_file(&file_path); // ignore if not found
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn attachments_cleanup(
    state: State<AppState>,
    board_id: String,
    card_id: String,
) -> Result<serde_json::Value, String> {
    if !is_valid_card_id(&card_id) {
        return Err("Invalid card ID".to_string());
    }
    let conn = state.db.lock().map_err(map_err)?;
    let board = boards::get(&conn, &board_id)
        .map_err(map_err)?
        .ok_or_else(|| "Board not found".to_string())?;

    let attachments_dir = PathBuf::from(&board.directory)
        .join(".glue-paste")
        .join("attachments")
        .join(&card_id);

    let _ = fs::remove_dir_all(&attachments_dir); // ignore if not found
    Ok(serde_json::json!({ "ok": true }))
}

fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    base.replace(['/', '\\', '\0'], "_")
}
