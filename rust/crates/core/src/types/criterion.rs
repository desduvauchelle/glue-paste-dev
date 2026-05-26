use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CriterionStatus {
    Pending,
    Pass,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
#[serde(rename_all = "lowercase")]
pub enum CriterionSource {
    Ai,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct Criterion {
    pub id: String,
    pub card_id: String,
    pub text: String,
    pub status: CriterionStatus,
    pub source: CriterionSource,
    pub evidence: Option<String>,
    pub execution_id: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct CreateCriterion {
    pub text: String,
    pub source: CriterionSource,
}

#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../../../packages/dashboard/src/types/generated/")]
pub struct UpdateCriterion {
    pub text: Option<String>,
    pub status: Option<CriterionStatus>,
    pub evidence: Option<Option<String>>,
}
