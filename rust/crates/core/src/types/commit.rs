use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CardCommit {
    pub id: String,
    pub card_id: String,
    pub execution_id: Option<String>,
    pub sha: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub files_changed: Option<String>,
    pub created_at: String,
}
