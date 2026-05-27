/// Auth command — stores an OAuth token to the filesystem.
/// Mirrors POST /api/auth/token from the Bun server.
use std::fs;
use std::path::PathBuf;

fn token_file_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    p.push(".glue-paste-dev");
    p.push("oauth-token");
    p
}

#[tauri::command]
pub fn auth_store_token(token: String) -> Result<serde_json::Value, String> {
    if token.is_empty() {
        return Err("token is required".to_string());
    }

    let path = token_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(&path, &token).map_err(|e| e.to_string())?;

    // Set permissions to 0o600 on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
    }

    Ok(serde_json::json!({ "ok": true }))
}
