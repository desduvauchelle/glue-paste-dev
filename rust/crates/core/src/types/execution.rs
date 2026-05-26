use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionPhase {
    Plan,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus {
    Running,
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Execution {
    pub id: String,
    pub card_id: String,
    pub session_id: Option<String>,
    pub phase: ExecutionPhase,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: ExecutionStatus,
    pub output: String,
    pub cost_usd: f64,
    pub exit_code: Option<i64>,
    pub retry_count: i64,
    pub pid: Option<i64>,
    pub files_changed: Option<String>,
}
