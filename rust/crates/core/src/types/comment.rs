use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CommentAuthor {
    User,
    System,
    Ai,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Comment {
    pub id: String,
    pub card_id: String,
    pub author: CommentAuthor,
    pub content: String,
    pub execution_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CreateComment {
    pub author: CommentAuthor,
    pub content: String,
    pub execution_id: Option<String>,
}
