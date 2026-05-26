use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "kebab-case")]
pub enum CardStatus {
    Todo,
    Queued,
    #[serde(rename = "in-progress")]
    InProgress,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum Assignee {
    Ai,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Card {
    pub id: String,
    pub board_id: String,
    pub title: String,
    pub description: String,
    pub status: CardStatus,
    pub position: i64,
    pub blocking: i64,
    pub plan_thinking: Option<String>,
    pub execute_thinking: Option<String>,
    pub auto_commit: Option<i64>,
    pub auto_push: Option<i64>,
    pub assignee: Assignee,
    pub cli_provider: Option<String>,
    pub cli_custom_command: Option<String>,
    pub branch_mode: Option<String>,
    pub branch_name: Option<String>,
    pub plan_summary: Option<String>,
    pub completion_summary: Option<String>,
    pub blocker: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CardWithTags {
    #[serde(flatten)]
    pub card: Card,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CreateCard {
    pub title: String,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
    pub assignee: Option<Assignee>,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct UpdateCard {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<CardStatus>,
    pub tags: Option<Vec<String>>,
    pub assignee: Option<Assignee>,
    pub plan_thinking: Option<Option<String>>,
    pub execute_thinking: Option<Option<String>>,
    pub auto_commit: Option<Option<i64>>,
    pub auto_push: Option<Option<i64>>,
    pub cli_provider: Option<Option<String>>,
    pub cli_custom_command: Option<Option<String>>,
    pub branch_mode: Option<Option<String>>,
    pub branch_name: Option<Option<String>>,
    pub blocker: Option<Option<String>>,
}
