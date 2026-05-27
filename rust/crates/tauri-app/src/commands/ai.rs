use serde::Deserialize;
use glue_paste_dev_core::executor::generate_title::generate_title;

#[derive(Deserialize)]
pub struct AiGenerateTitleArgs {
    pub description: String,
}

#[tauri::command]
pub async fn ai_generate_title(args: AiGenerateTitleArgs) -> Result<String, String> {
    Ok(generate_title(&args.description).await)
}
