use tauri::{AppHandle, Emitter};
use glue_paste_dev_core::executor::chat::ChatCallbacks;
use glue_paste_dev_core::executor::queue::{QueueCallbacks, QueueState, QueueStatus};
use glue_paste_dev_core::executor::runner::RunnerCallbacks;
use glue_paste_dev_core::types::{CardWithTags, Comment, ExecutionPhase};
use serde::Serialize;

pub struct AppEventCallbacks {
    pub app: AppHandle,
}

#[derive(Serialize, Clone)]
struct ExecStartedPayload {
    #[serde(rename = "cardId")]
    card_id: String,
    #[serde(rename = "executionId")]
    execution_id: String,
    phase: String,
}

#[derive(Serialize, Clone)]
struct ExecOutputPayload {
    #[serde(rename = "executionId")]
    execution_id: String,
    chunk: String,
}

#[derive(Serialize, Clone)]
struct ExecCompletedPayload {
    #[serde(rename = "executionId")]
    execution_id: String,
    status: String,
    #[serde(rename = "exitCode")]
    exit_code: i32,
    #[serde(rename = "errorSummary")]
    error_summary: Option<String>,
}

#[derive(Serialize, Clone)]
struct QueueUpdatedPayload {
    #[serde(rename = "boardId")]
    board_id: String,
    queue: Vec<String>,
    current: Option<String>,
    #[serde(rename = "isPaused")]
    is_paused: bool,
    active: Vec<String>,
}

#[derive(Serialize, Clone)]
struct QueueStoppedPayload {
    #[serde(rename = "boardId")]
    board_id: String,
    reason: String,
}

impl RunnerCallbacks for AppEventCallbacks {
    fn on_execution_started(&self, card_id: &str, execution_id: &str, phase: ExecutionPhase) {
        let phase_str = match phase {
            ExecutionPhase::Plan => "plan",
            ExecutionPhase::Execute => "execute",
        };
        let _ = self.app.emit("execution:started", ExecStartedPayload {
            card_id: card_id.to_string(),
            execution_id: execution_id.to_string(),
            phase: phase_str.to_string(),
        });
    }

    fn on_output(&self, execution_id: &str, chunk: &str) {
        let _ = self.app.emit("execution:output", ExecOutputPayload {
            execution_id: execution_id.to_string(),
            chunk: chunk.to_string(),
        });
    }

    fn on_execution_completed(&self, execution_id: &str, status: &str, exit_code: i32, error_summary: Option<&str>) {
        let _ = self.app.emit("execution:completed", ExecCompletedPayload {
            execution_id: execution_id.to_string(),
            status: status.to_string(),
            exit_code,
            error_summary: error_summary.map(|s| s.to_string()),
        });
    }

    fn on_card_updated(&self, card: &CardWithTags) {
        let _ = self.app.emit("card:updated", card);
    }

    fn on_comment_added(&self, comment: &Comment) {
        let _ = self.app.emit("comment:added", comment);
    }
}

impl ChatCallbacks for AppEventCallbacks {
    fn on_output(&self, card_id: &str, chunk: &str) {
        let _ = self.app.emit(
            "chat:output",
            serde_json::json!({ "cardId": card_id, "chunk": chunk }),
        );
    }

    fn on_completed(&self, card_id: &str, comment: &Comment) {
        let _ = self.app.emit(
            "chat:completed",
            serde_json::json!({ "cardId": card_id, "commentId": comment.id }),
        );
    }

    fn on_comment_added(&self, comment: &Comment) {
        let _ = self.app.emit("comment:added", comment);
    }
}

impl QueueCallbacks for AppEventCallbacks {
    fn on_queue_state_changed(&self, state: &QueueState) {
        let _ = self.app.emit("queue:updated", QueueUpdatedPayload {
            board_id: state.board_id.clone(),
            queue: state.queue.clone(),
            current: state.current.clone(),
            is_paused: matches!(state.status, QueueStatus::Paused) || state.is_paused,
            active: state.active.clone(),
        });
    }

    fn on_queue_updated(
        &self,
        board_id: &str,
        queue: &[String],
        current: Option<&str>,
        is_paused: bool,
        active: &[String],
    ) {
        let _ = self.app.emit("queue:updated", QueueUpdatedPayload {
            board_id: board_id.to_string(),
            queue: queue.to_vec(),
            current: current.map(|s| s.to_string()),
            is_paused,
            active: active.to_vec(),
        });
    }

    fn on_queue_stopped(&self, board_id: &str, reason: &str) {
        let _ = self.app.emit("queue:stopped", QueueStoppedPayload {
            board_id: board_id.to_string(),
            reason: reason.to_string(),
        });
    }

    fn on_rate_limited(
        &self,
        _board_id: &str,
        _card_title: &str,
        _retry_in_seconds: u64,
        _reset_message: Option<&str>,
    ) {
        // Rate-limit notification — deferred (Phase 4.7)
    }

    fn on_overloaded(&self, _board_id: &str, _card_title: &str, _retry_in_seconds: u64) {
        // Overloaded notification — deferred (Phase 4.7)
    }
}
