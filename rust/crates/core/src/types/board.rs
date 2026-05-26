use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub session_id: Option<String>,
    pub color: Option<String>,
    pub scratchpad: String,
    pub slug: Option<String>,
    pub github_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CreateBoard {
    pub name: String,
    pub description: String,
    pub directory: String,
    pub color: Option<String>,
    pub slug: Option<String>,
    pub github_url: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct UpdateBoard {
    pub name: Option<String>,
    pub description: Option<String>,
    pub directory: Option<String>,
    pub color: Option<Option<String>>,
    pub scratchpad: Option<String>,
    pub slug: Option<Option<String>>,
    pub github_url: Option<Option<String>>,
}
