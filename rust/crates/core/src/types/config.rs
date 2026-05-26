use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Config {
    pub key: String,
    pub cli_provider: Option<String>,
    pub cli_custom_command: Option<String>,
    pub model: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub plan_mode: Option<i64>,
    pub thinking_level: Option<String>,
    pub custom_tags: Option<String>,
    pub custom_instructions: Option<String>,
    pub plan_thinking: Option<String>,
    pub execute_thinking: Option<String>,
    pub auto_commit: Option<i64>,
    pub plan_model: Option<String>,
    pub execute_model: Option<String>,
    pub auto_push: Option<i64>,
    pub branch_mode: Option<String>,
    pub branch_name: Option<String>,
    pub max_concurrent_cards: Option<i64>,
    pub terminal_permission_mode: Option<String>,
}
