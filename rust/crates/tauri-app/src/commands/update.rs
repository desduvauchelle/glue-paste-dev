use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current: String,
    pub latest: String,
    pub asset_url: Option<String>,
}

#[tauri::command]
pub async fn update_check() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();

    let res = reqwest::Client::new()
        .get("https://api.github.com/repos/desduvauchelle/glue-paste-dev/releases/latest")
        .header("User-Agent", "glue-paste-dev-tauri")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Ok(UpdateInfo {
            available: false,
            current: current.clone(),
            latest: current,
            asset_url: None,
        });
    }

    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let tag = body["tag_name"]
        .as_str()
        .unwrap_or("v0.0.0")
        .trim_start_matches('v')
        .to_string();

    let asset_url = body["assets"]
        .as_array()
        .and_then(|arr| {
            arr.iter().find(|a| {
                a["name"]
                    .as_str()
                    .map_or(false, |n| n.ends_with("arm64.dmg"))
            })
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .map(|s| s.to_string());

    let available = tag != current;
    Ok(UpdateInfo { available, current, latest: tag, asset_url })
}
