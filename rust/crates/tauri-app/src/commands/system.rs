#[tauri::command]
pub fn system_open_folder(path: String) -> Result<serde_json::Value, String> {
    use std::path::Path;

    if path.is_empty() {
        return Err("Missing path".to_string());
    }

    let p = Path::new(&path);
    if !p.exists() || !p.is_dir() {
        return Err("Directory not found".to_string());
    }

    // macOS: open, Linux: xdg-open, Windows: explorer
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";

    std::process::Command::new(cmd)
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "ok": true }))
}
