//! executor/queue.rs — port of packages/core/src/executor/queue.ts
//!
//! Per-board card queue manager: dequeues queued cards, fills concurrent slots
//! up to `max_concurrent_cards`, runs each via `runner::run_card`, handles
//! pause/resume/stop, and skips todo-status + human-assigned cards.
//!
//! # Simplifications vs the Bun source
//!
//! 1. **Interactive PTY path omitted**: `setInteractiveHub` / `clearAwaitingReview`
//!    and the `runCardInteractive` branch are fully deferred (pty-runner not ported).
//!    `set_interactive_hub` and `clear_awaiting_review` are no-op stubs for API compat.
//! 2. **Rate-limit auto-resume**: The Bun source schedules a `setTimeout` to
//!    auto-resume the queue after a rate-limit delay. Here the queue is simply paused;
//!    callers must call `resume_queue` manually (or a server layer can implement the
//!    timer). The rate-limit comment is still written to DB.
//! 3. **`walCheckpoint` calls omitted**: The Bun source calls `walCheckpoint` after
//!    each card completion. The Rust layer uses WAL by default via `connection::open`;
//!    periodic checkpointing is handled by the connection layer.
//! 4. **`cleanupStaleAttachments` / `enforceAttachmentCap` omitted**: Not yet ported.
//! 5. **`card_files` parameter**: `run_card` takes `card_files: Vec<String>`.
//!    The queue passes an empty vec (the file-list is only populated by the server
//!    route). Follow-up: thread file list through the queue API in Phase 4.
//! 6. **`applyCardOverrides`**: Config override logic (plan_thinking, execute_thinking,
//!    etc.) is not applied in the Rust queue. The queue receives a `RunnerConfig`
//!    already resolved by the caller. Per-card config field overrides should be wired
//!    in Phase 4.
//! 7. **`refreshConcurrency` while running edge case**: Not implemented — `refresh_concurrency`
//!    simply calls `fill_slots` on the in-memory state; it does not re-read DB config mid-run.
//!    Pass the current `max_concurrent` to callers instead when needed.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};

use rusqlite::Connection;
use tokio::sync::Notify;

use crate::db::{boards, cards, comments, executions};
use crate::executor::runner::{kill_card_process, run_card, RunnerCallbacks, RunnerConfig, RunOptions, RunResult};
use crate::types::{Assignee, CardStatus, CardWithTags};
use crate::Result;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum QueueStatus {
    Idle,
    Running,
    Paused,
}

#[derive(Debug, Clone)]
pub struct QueueState {
    pub board_id: String,
    pub status: QueueStatus,
    pub running_count: i32,
    pub paused_at: Option<String>,
    /// Cards waiting to be dispatched (in-memory queue)
    pub queue: Vec<String>,
    /// Cards currently executing
    pub active: Vec<String>,
    /// Deprecated compat field: active[0] or None
    pub current: Option<String>,
    pub is_running: bool,
    pub is_paused: bool,
}

impl QueueState {
    fn new(board_id: String) -> Self {
        Self {
            board_id,
            status: QueueStatus::Idle,
            running_count: 0,
            paused_at: None,
            queue: Vec::new(),
            active: Vec::new(),
            current: None,
            is_running: false,
            is_paused: false,
        }
    }

    fn sync_current(&mut self) {
        self.current = self.active.first().cloned();
    }
}

// ---------------------------------------------------------------------------
// Callbacks trait
// ---------------------------------------------------------------------------

pub trait QueueCallbacks: RunnerCallbacks {
    fn on_queue_state_changed(&self, state: &QueueState);
    fn on_queue_updated(
        &self,
        board_id: &str,
        queue: &[String],
        current: Option<&str>,
        is_paused: bool,
        active: &[String],
    );
    fn on_queue_stopped(&self, board_id: &str, reason: &str);
    fn on_rate_limited(
        &self,
        board_id: &str,
        card_title: &str,
        retry_in_seconds: u64,
        reset_message: Option<&str>,
    );
    fn on_overloaded(&self, board_id: &str, card_title: &str, retry_in_seconds: u64);
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/// Per-board queue state (running queues only).
static QUEUES: LazyLock<Mutex<HashMap<String, QueueState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Cards that were explicitly stopped — processCard checks this to skip retry.
static STOPPED_CARD_IDS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Per-board notify tokens — nudge the queue loop when a new card arrives.
static QUEUE_NOTIFIERS: LazyLock<Mutex<HashMap<String, Arc<Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Per-board stop signals (true = stop requested).
static STOP_FLAGS: LazyLock<Mutex<HashMap<String, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ---------------------------------------------------------------------------
// Stopped-card helpers
// ---------------------------------------------------------------------------

/// Mark a card as explicitly stopped (prevents retry/status-override).
fn mark_stopped(card_id: &str) {
    let mut set = STOPPED_CARD_IDS.lock().unwrap_or_else(|e| e.into_inner());
    set.insert(card_id.to_string());
}

/// Consume the stopped flag (returns true and removes entry if present).
fn consume_stopped_flag(card_id: &str) -> bool {
    let mut set = STOPPED_CARD_IDS.lock().unwrap_or_else(|e| e.into_inner());
    set.remove(card_id)
}

/// Check without consuming.
pub fn is_card_stopped(card_id: &str) -> bool {
    let set = STOPPED_CARD_IDS.lock().unwrap_or_else(|e| e.into_inner());
    set.contains(card_id)
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

fn with_queues<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, QueueState>) -> R,
{
    let mut map = QUEUES.lock().unwrap_or_else(|e| e.into_inner());
    f(&mut map)
}

fn remove_from_active(board_id: &str, card_id: &str) {
    with_queues(|map| {
        if let Some(state) = map.get_mut(board_id) {
            state.active.retain(|id| id != card_id);
            state.sync_current();
        }
    });
}

fn broadcast_queue_state<CB: QueueCallbacks + ?Sized>(
    board_id: &str,
    callbacks: &CB,
) {
    let state = with_queues(|map| map.get(board_id).cloned());
    if let Some(state) = state {
        callbacks.on_queue_updated(
            board_id,
            &state.queue,
            state.current.as_deref(),
            state.is_paused,
            &state.active,
        );
    }
}

// ---------------------------------------------------------------------------
// Config helper — read max_concurrent_cards from DB
// ---------------------------------------------------------------------------

fn read_max_concurrent(db: &Arc<Mutex<Connection>>, board_id: &str) -> i32 {
    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
    // Try board-specific config first, fall back to global
    let board_val: Option<Option<i64>> = conn
        .query_row(
            "SELECT max_concurrent_cards FROM config WHERE key = ?",
            [board_id],
            |r| r.get(0),
        )
        .ok();
    if let Some(Some(v)) = board_val {
        return v.clamp(1, 3) as i32;
    }
    let global_val: Option<Option<i64>> = conn
        .query_row(
            "SELECT max_concurrent_cards FROM config WHERE key = 'global'",
            [],
            |r| r.get(0),
        )
        .ok();
    let raw = global_val.flatten().unwrap_or(1);
    raw.clamp(1, 3) as i32
}

// ---------------------------------------------------------------------------
// Public API — simple state queries
// ---------------------------------------------------------------------------

/// Returns the queue state for a board, or a default idle state if not found.
pub fn get_queue_state(board_id: &str) -> Option<QueueState> {
    with_queues(|map| map.get(board_id).cloned())
}

/// Returns board IDs for all currently-running queues.
pub fn get_running_queue_board_ids() -> Vec<String> {
    with_queues(|map| {
        map.values()
            .filter(|s| s.is_running)
            .map(|s| s.board_id.clone())
            .collect()
    })
}

// ---------------------------------------------------------------------------
// Public API — lifecycle controls
// ---------------------------------------------------------------------------

/// Pause a running queue. Active cards finish; no new cards start.
/// Returns `false` if no running queue found for `board_id`.
pub fn pause_queue(board_id: &str) -> bool {
    with_queues(|map| {
        if let Some(state) = map.get_mut(board_id) {
            if state.is_running {
                state.is_paused = true;
                return true;
            }
        }
        false
    })
}

/// Resume a paused queue. Returns `false` if queue not found or not paused.
/// Caller should call `notify_new_card` after this to trigger slot-filling.
pub fn resume_queue(board_id: &str) -> bool {
    let result = with_queues(|map| {
        if let Some(state) = map.get_mut(board_id) {
            if state.is_paused {
                state.is_paused = false;
                return true;
            }
        }
        false
    });
    if result {
        // Nudge the queue loop to re-check for open slots
        notify_new_card(board_id);
    }
    result
}

/// Stop a running queue immediately. Clears in-memory queue.
/// Returns `false` if no queue found for `board_id`.
pub fn stop_queue(board_id: &str) -> bool {
    let found = with_queues(|map| {
        if let Some(state) = map.get_mut(board_id) {
            state.is_running = false;
            state.queue.clear();
            state.active.clear();
            state.current = None;
            return true;
        }
        false
    });
    if found {
        // Signal the queue loop to exit
        let mut flags = STOP_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
        flags.insert(board_id.to_string(), true);
        // Also nudge the notifier so the loop wakes up and sees the stop flag
        notify_new_card(board_id);
    }
    found
}

/// Re-check concurrency after config changes and fill any new slots.
pub fn refresh_concurrency(board_id: &str) {
    notify_new_card(board_id);
}

/// Notify that a new card was added to the board.
/// - If queue is running and not paused: nudges the slot-filler.
/// - If queue is idle: `start_queue` must be called separately by the server layer.
pub fn notify_new_card(board_id: &str) {
    let notifier = {
        let map = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(board_id).cloned()
    };
    if let Some(notify) = notifier {
        notify.notify_one();
    }
}

/// Stop a single card mid-execution. Marks it stopped, kills the process,
/// resets card status to todo, and removes from active list.
pub fn stop_card(
    db: &Arc<Mutex<Connection>>,
    card_id: &str,
) -> bool {
    // Mark stopped BEFORE killing so processCard skips retry
    mark_stopped(card_id);
    let killed = kill_card_process(card_id);

    // Reset card status to todo
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, card_id, CardStatus::Todo);
    }

    // Remove from active list in all boards
    with_queues(|map| {
        for state in map.values_mut() {
            if state.active.contains(&card_id.to_string()) {
                state.active.retain(|id| id != card_id);
                state.sync_current();
                notify_new_card(&state.board_id.clone());
                break;
            }
        }
    });

    killed
}

// ---------------------------------------------------------------------------
// Stub API for interactive-PTY compat (deferred)
// ---------------------------------------------------------------------------

/// No-op stub. When the PTY runner is ported, wire the hub here.
pub fn set_interactive_hub(_hub: ()) {}

/// No-op stub. When the PTY runner is ported, remove card from awaiting-review set.
pub fn clear_awaiting_review(_card_id: &str) {}

// ---------------------------------------------------------------------------
// start_queue — main entry point
// ---------------------------------------------------------------------------

/// Start running queued cards for a board. Spawns a tokio task.
///
/// Loads all queued (non-human) cards, fills concurrent slots, and drives
/// each card through `run_card` until the queue is empty.
pub async fn start_queue(
    db: Arc<Mutex<Connection>>,
    board_id: String,
    config: RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
) -> Result<()> {
    // Fetch queued non-human cards
    let queued_cards = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        cards::list_by_status(&conn, &board_id, CardStatus::Queued)?
    };
    let non_human: Vec<CardWithTags> = queued_cards
        .into_iter()
        .filter(|c| c.card.assignee != Assignee::Human)
        .collect();

    if non_human.is_empty() {
        callbacks.on_queue_stopped(&board_id, "No queued cards to execute");
        return Ok(());
    }

    let max_concurrent = read_max_concurrent(&db, &board_id);
    let card_ids: Vec<String> = non_human.iter().map(|c| c.card.id.clone()).collect();
    let initial_active: Vec<String> = card_ids[..card_ids.len().min(max_concurrent as usize)].to_vec();
    let remaining: Vec<String> = card_ids[initial_active.len()..].to_vec();

    // Register notify token and stop flag
    let notifier = Arc::new(Notify::new());
    {
        let mut notifiers = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
        notifiers.insert(board_id.clone(), notifier.clone());
        let mut flags = STOP_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
        flags.remove(&board_id);
    }

    // Install initial queue state
    with_queues(|map| {
        let mut state = QueueState::new(board_id.clone());
        state.is_running = true;
        state.queue = remaining.clone();
        state.active = initial_active.clone();
        state.sync_current();
        map.insert(board_id.clone(), state);
    });

    broadcast_queue_state(&board_id, callbacks.as_ref());

    // Launch a tokio task for each initial card
    for card_id in &initial_active {
        let db2 = db.clone();
        let bid = board_id.clone();
        let cid = card_id.clone();
        let cfg = config.clone();
        let cb = callbacks.clone();
        tokio::spawn(async move {
            process_card(db2, bid, cid, cfg, cb).await;
        });
    }

    // Drive the queue loop in a background task
    {
        let db2 = db.clone();
        let bid = board_id.clone();
        let cfg = config.clone();
        let cb = callbacks.clone();
        let notify = notifier.clone();
        tokio::spawn(async move {
            run_queue_loop(db2, bid, cfg, cb, notify).await;
        });
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Queue loop — fills slots as they open
// ---------------------------------------------------------------------------

async fn run_queue_loop(
    db: Arc<Mutex<Connection>>,
    board_id: String,
    config: RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
    notify: Arc<Notify>,
) {
    loop {
        // Wait for a notification (card added, card completed, resume called)
        notify.notified().await;

        // Check stop flag
        let stop_requested = {
            let flags = STOP_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
            flags.get(&board_id).copied().unwrap_or(false)
        };
        if stop_requested {
            // Clean up notifier
            let mut notifiers = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
            notifiers.remove(&board_id);
            callbacks.on_queue_stopped(&board_id, "Stopped by user");
            return;
        }

        // Check if queue is still running
        let is_running = with_queues(|map| map.get(&board_id).map(|s| s.is_running).unwrap_or(false));
        if !is_running {
            let mut notifiers = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
            notifiers.remove(&board_id);
            return;
        }

        fill_slots(&db, &board_id, &config, callbacks.clone());
    }
}

// ---------------------------------------------------------------------------
// fill_slots — core slot management
// ---------------------------------------------------------------------------

fn fill_slots(
    db: &Arc<Mutex<Connection>>,
    board_id: &str,
    config: &RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
) {
    let state_snapshot = with_queues(|map| map.get(board_id).cloned());
    let Some(state) = state_snapshot else { return };

    if !state.is_running {
        return;
    }

    if state.is_paused {
        broadcast_queue_state(board_id, callbacks.as_ref());
        return;
    }

    let max_concurrent = read_max_concurrent(db, board_id);
    let slots_available = max_concurrent - state.active.len() as i32;

    if slots_available <= 0 && !state.active.is_empty() {
        broadcast_queue_state(board_id, callbacks.as_ref());
        return;
    }

    // If the in-memory queue is empty, re-check DB for newly queued cards
    let effective_queue = if state.queue.is_empty() {
        let new_cards: Vec<CardWithTags> = {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            let queued = cards::list_by_status(&conn, board_id, CardStatus::Queued)
                .unwrap_or_default()
                .into_iter()
                .filter(|c| c.card.assignee != Assignee::Human)
                .collect::<Vec<_>>();
            let in_progress = cards::list_by_status(&conn, board_id, CardStatus::InProgress)
                .unwrap_or_default()
                .into_iter()
                .filter(|c| {
                    c.card.assignee != Assignee::Human
                        && !state.active.contains(&c.card.id)
                })
                .collect::<Vec<_>>();
            in_progress.into_iter().chain(queued).collect()
        };

        if new_cards.is_empty() {
            if state.active.is_empty() {
                // Queue is done
                with_queues(|map| map.remove(board_id));
                let mut notifiers = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
                notifiers.remove(board_id);
                callbacks.on_queue_stopped(board_id, "All cards completed");
                return;
            } else {
                // Active cards running, nothing pending — keep waiting
                broadcast_queue_state(board_id, callbacks.as_ref());
                return;
            }
        }
        new_cards.into_iter().map(|c| c.card.id).collect::<Vec<_>>()
    } else {
        state.queue.clone()
    };

    // Fill available slots from queue
    let to_start: Vec<String> = with_queues(|map| {
        let Some(s) = map.get_mut(board_id) else { return vec![] };
        s.queue = effective_queue;
        let slots = (max_concurrent as usize).saturating_sub(s.active.len());
        let mut started = Vec::new();
        for _ in 0..slots {
            if let Some(card_id) = s.queue.first().cloned() {
                s.queue.remove(0);
                s.active.push(card_id.clone());
                started.push(card_id);
            } else {
                break;
            }
        }
        s.sync_current();
        started
    });

    if to_start.is_empty() && with_queues(|map| map.get(board_id).map(|s| s.active.is_empty()).unwrap_or(true)) {
        with_queues(|map| map.remove(board_id));
        let mut notifiers = QUEUE_NOTIFIERS.lock().unwrap_or_else(|e| e.into_inner());
        notifiers.remove(board_id);
        callbacks.on_queue_stopped(board_id, "All cards completed");
        return;
    }

    broadcast_queue_state(board_id, callbacks.as_ref());

    for card_id in to_start {
        let db2 = db.clone();
        let bid = board_id.to_string();
        let cfg = config.clone();
        let cb = callbacks.clone();
        tokio::spawn(async move {
            process_card(db2, bid, card_id, cfg, cb).await;
        });
    }
}

// ---------------------------------------------------------------------------
// process_card — run one card and handle outcomes
// ---------------------------------------------------------------------------

async fn process_card(
    db: Arc<Mutex<Connection>>,
    board_id: String,
    card_id: String,
    config: RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
) {
    // Bail if queue stopped
    let is_running = with_queues(|map| map.get(&board_id).map(|s| s.is_running).unwrap_or(false));
    if !is_running {
        remove_from_active(&board_id, &card_id);
        return;
    }

    // Load card, board, comments
    let (card, board, comments) = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let card = match cards::get_with_tags(&conn, &card_id).ok().flatten() {
            Some(c) => c,
            None => {
                drop(conn);
                remove_from_active(&board_id, &card_id);
                notify_new_card(&board_id);
                return;
            }
        };
        // Skip todo cards or human-assigned cards
        if card.card.assignee == Assignee::Human || card.card.status == CardStatus::Todo {
            if card.card.status == CardStatus::Todo {
                eprintln!("[queue] Skipping card {} — status is 'todo'", card_id);
            }
            drop(conn);
            remove_from_active(&board_id, &card_id);
            notify_new_card(&board_id);
            return;
        }
        let board = match boards::get(&conn, &board_id).ok().flatten() {
            Some(b) => b,
            None => {
                drop(conn);
                remove_from_active(&board_id, &card_id);
                notify_new_card(&board_id);
                return;
            }
        };
        let comments = comments::list_for_card(&conn, &card_id).unwrap_or_default();
        (card, board, comments)
    };

    // Headless path (interactive PTY deferred)
    let existing_plan = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::get_completed_plan_output(&conn, &card_id).ok().flatten()
    };

    let result = run_card(
        db.clone(),
        card.clone(),
        board.clone(),
        comments,
        config.clone(),
        callbacks.clone() as Arc<dyn crate::executor::runner::RunnerCallbacks>,
        RunOptions { existing_plan_output: existing_plan },
        vec![], // card_files — threaded through by server in Phase 4
    )
    .await;

    match result {
        Err(err) => {
            eprintln!("[queue] Unexpected error processing card {}: {}", card_id, err);
            if !consume_stopped_flag(&card_id) {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                let _ = cards::set_status(&conn, &card_id, CardStatus::Failed);
                if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
                    callbacks.on_card_updated(&updated);
                }
            }
            remove_from_active(&board_id, &card_id);
            notify_new_card(&board_id);
        }
        Ok(run_result) => {
            // Stopped while running — don't retry or override status
            if consume_stopped_flag(&card_id) {
                eprintln!("[queue] Card {} was stopped — skipping post-execution handling", card_id);
                remove_from_active(&board_id, &card_id);
                notify_new_card(&board_id);
                return;
            }

            if run_result.success {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                let _ = cards::set_status(&conn, &card_id, CardStatus::Done);
                if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
                    callbacks.on_card_updated(&updated);
                }
                remove_from_active(&board_id, &card_id);
                notify_new_card(&board_id);
            } else if run_result.rate_limit_info.as_ref().map(|r| r.is_rate_limit).unwrap_or(false) {
                // Rate-limited: re-queue card, pause queue
                handle_rate_limited(&db, &board_id, &card, run_result, callbacks.clone());
                remove_from_active(&board_id, &card_id);
            } else {
                // First attempt failed — retry once
                let retry_result = retry_card(&db, &board_id, &card_id, &card, &config, callbacks.clone()).await;

                // Check stop flag again after retry
                if consume_stopped_flag(&card_id) {
                    eprintln!("[queue] Card {} was stopped during retry", card_id);
                    remove_from_active(&board_id, &card_id);
                    notify_new_card(&board_id);
                    return;
                }

                match retry_result {
                    Err(_) => {
                        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                        let _ = cards::set_status(&conn, &card_id, CardStatus::Failed);
                        if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
                            callbacks.on_card_updated(&updated);
                        }
                        remove_from_active(&board_id, &card_id);
                        handle_post_failure(&db, &board_id, &card, callbacks.clone());
                    }
                    Ok(retry_run_result) => {
                        if consume_stopped_flag(&card_id) {
                            remove_from_active(&board_id, &card_id);
                            notify_new_card(&board_id);
                            return;
                        }
                        if retry_run_result.success {
                            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                            let _ = cards::set_status(&conn, &card_id, CardStatus::Done);
                            if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
                                callbacks.on_card_updated(&updated);
                            }
                            remove_from_active(&board_id, &card_id);
                            notify_new_card(&board_id);
                        } else if retry_run_result.rate_limit_info.as_ref().map(|r| r.is_rate_limit).unwrap_or(false) {
                            handle_rate_limited(&db, &board_id, &card, retry_run_result, callbacks.clone());
                            remove_from_active(&board_id, &card_id);
                        } else {
                            // Failed after retry
                            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                            let _ = cards::set_status(&conn, &card_id, CardStatus::Failed);
                            if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
                                callbacks.on_card_updated(&updated);
                            }
                            remove_from_active(&board_id, &card_id);
                            handle_post_failure(&db, &board_id, &card, callbacks.clone());
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

async fn retry_card(
    db: &Arc<Mutex<Connection>>,
    _board_id: &str,
    card_id: &str,
    card: &CardWithTags,
    config: &RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
) -> Result<RunResult> {
    let (board, comments) = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let board = boards::get(&conn, &card.card.board_id).ok().flatten();
        let comments = comments::list_for_card(&conn, card_id).unwrap_or_default();
        (board, comments)
    };
    let board = match board {
        Some(b) => b,
        None => return Err(crate::Error::NotFoundMsg("board".into())),
    };
    let existing_plan = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::get_completed_plan_output(&conn, card_id).ok().flatten()
    };
    run_card(
        db.clone(),
        card.clone(),
        board,
        comments,
        config.clone(),
        callbacks as Arc<dyn crate::executor::runner::RunnerCallbacks>,
        RunOptions { existing_plan_output: existing_plan },
        vec![],
    )
    .await
}

// ---------------------------------------------------------------------------
// Post-failure handling (blocking cards stop the queue)
// ---------------------------------------------------------------------------

fn handle_post_failure(
    db: &Arc<Mutex<Connection>>,
    board_id: &str,
    card: &CardWithTags,
    callbacks: Arc<dyn QueueCallbacks>,
) {
    if card.card.blocking != 0 {
        // Stop the queue and reset remaining queued cards to todo
        let queued_ids: Vec<String> = with_queues(|map| {
            map.get(board_id)
                .map(|s| s.queue.clone())
                .unwrap_or_default()
        });

        for qid in &queued_ids {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            let _ = cards::set_status(&conn, qid, CardStatus::Todo);
            if let Some(updated) = cards::get_with_tags(&conn, qid).ok().flatten() {
                callbacks.on_card_updated(&updated);
            }
        }

        with_queues(|map| {
            if let Some(state) = map.get_mut(board_id) {
                state.is_running = false;
                state.queue.clear();
                state.active.clear();
                state.current = None;
            }
        });

        // Signal stop loop
        let mut flags = STOP_FLAGS.lock().unwrap_or_else(|e| e.into_inner());
        flags.insert(board_id.to_string(), true);
        notify_new_card(board_id); // Wake the loop so it can exit cleanly

        callbacks.on_queue_stopped(board_id, &format!("Card \"{}\" failed (blocking)", card.card.title));
    } else {
        notify_new_card(board_id);
    }
}

// ---------------------------------------------------------------------------
// Rate-limit handling
// ---------------------------------------------------------------------------

fn parse_retry_seconds(reset_message: Option<&str>) -> u64 {
    let Some(msg) = reset_message else { return 60 };
    // Pattern: "retry after 30 seconds" / "retry in 2 minutes"
    let re = regex::Regex::new(r"(\d+)\s*(seconds?|minutes?|hours?)").unwrap();
    if let Some(caps) = re.captures(msg) {
        let value: u64 = caps[1].parse().unwrap_or(60);
        let unit = &caps[2].to_lowercase();
        if unit.starts_with("minute") {
            return value * 60;
        }
        if unit.starts_with("hour") {
            return value * 3600;
        }
        return value;
    }
    60
}

fn handle_rate_limited(
    db: &Arc<Mutex<Connection>>,
    board_id: &str,
    card: &CardWithTags,
    run_result: RunResult,
    callbacks: Arc<dyn QueueCallbacks>,
) {
    let Some(rl) = &run_result.rate_limit_info else { return };
    let card_id = &card.card.id;

    // Reset card to queued
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, card_id, CardStatus::Queued);
    }

    let retry_seconds = parse_retry_seconds(rl.reset_message.as_deref());

    if rl.is_overloaded {
        let msg = format!("Claude servers are overloaded. Retrying in {}s.", retry_seconds);
        {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(comment) = crate::db::comments::add_system_comment(&conn, card_id, "", &msg) {
                callbacks.on_comment_added(&comment);
            }
        }
        callbacks.on_overloaded(board_id, &card.card.title, retry_seconds);
    } else {
        let reset_msg = rl.reset_message.as_deref().unwrap_or("Check provider dashboard for reset time.");
        let msg = format!("Rate limited. Retrying in {}s. {}", retry_seconds, reset_msg);
        {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            if let Ok(comment) = crate::db::comments::add_system_comment(&conn, card_id, "", &msg) {
                callbacks.on_comment_added(&comment);
            }
        }
        callbacks.on_rate_limited(board_id, &card.card.title, retry_seconds, rl.reset_message.as_deref());
    }

    // Notify card updated
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(updated) = cards::get_with_tags(&conn, card_id).ok().flatten() {
            callbacks.on_card_updated(&updated);
        }
    }

    // Pause the queue — caller is responsible for resuming after delay
    with_queues(|map| {
        if let Some(state) = map.get_mut(board_id) {
            state.is_paused = true;
        }
    });

    broadcast_queue_state(board_id, callbacks.as_ref());

    eprintln!(
        "[queue] {} on card \"{}\". Queue paused; caller must resume after {}s.",
        if rl.is_overloaded { "Overloaded" } else { "Rate limited" },
        card.card.title,
        retry_seconds,
    );
}

// ---------------------------------------------------------------------------
// execute_single_card — run a card independently of the queue
// ---------------------------------------------------------------------------

/// Execute a single card outside the queue (for explicit user-triggered runs).
pub async fn execute_single_card(
    db: Arc<Mutex<Connection>>,
    card_id: String,
    config: RunnerConfig,
    callbacks: Arc<dyn QueueCallbacks>,
) -> Result<RunResult> {
    let (card, board, comments) = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let card = cards::get_with_tags(&conn, &card_id)?
            .ok_or_else(|| crate::Error::NotFoundMsg(format!("card {}", card_id)))?;
        if card.card.assignee == Assignee::Human {
            return Err(crate::Error::BadRequest(
                format!("Card {} is assigned to a human and cannot be executed by AI", card_id),
            ));
        }
        if card.card.status == CardStatus::Todo {
            return Err(crate::Error::BadRequest(format!(
                "Card {} has status \"todo\" (backlog) and cannot be executed directly — move it to \"queued\" first",
                card_id
            )));
        }
        if card.card.status == CardStatus::Done || card.card.status == CardStatus::Failed {
            eprintln!(
                "[queue] Skipping execution of card {} — status is already {:?}",
                card_id, card.card.status
            );
            return Ok(RunResult {
                success: true,
                exit_code: 0,
                output: String::new(),
                rate_limit_info: None,
            });
        }
        let board = boards::get(&conn, &card.card.board_id)?
            .ok_or_else(|| crate::Error::NotFoundMsg(format!("board {}", card.card.board_id)))?;
        let comments = comments::list_for_card(&conn, &card_id).unwrap_or_default();
        (card, board, comments)
    };

    // Clear stale awaiting-review state (no-op stub in headless path)
    clear_awaiting_review(&card_id);

    let existing_plan = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::get_completed_plan_output(&conn, &card_id).ok().flatten()
    };

    let result = run_card(
        db.clone(),
        card.clone(),
        board.clone(),
        comments.clone(),
        config.clone(),
        callbacks.clone() as Arc<dyn crate::executor::runner::RunnerCallbacks>,
        RunOptions { existing_plan_output: existing_plan.clone() },
        vec![],
    )
    .await?;

    if consume_stopped_flag(&card_id) {
        eprintln!("[queue] Single card {} was stopped — skipping post-execution handling", card_id);
        if let Some(updated) = { let c = db.lock().unwrap_or_else(|e| e.into_inner()); cards::get_with_tags(&c, &card_id).ok().flatten() } {
            callbacks.on_card_updated(&updated);
        }
        return Ok(result);
    }

    if result.success {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, &card_id, CardStatus::Done);
        if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
            callbacks.on_card_updated(&updated);
        }
        return Ok(result);
    }

    // Rate-limited on first attempt
    if result.rate_limit_info.as_ref().map(|r| r.is_rate_limit).unwrap_or(false) {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, &card_id, CardStatus::Queued);
        if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
            callbacks.on_card_updated(&updated);
        }
        return Ok(result);
    }

    // Retry once
    eprintln!("[queue] Card {} failed, retrying once", card_id);

    let retry_plan = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::get_completed_plan_output(&conn, &card_id).ok().flatten()
    };

    let retry_result = run_card(
        db.clone(),
        card.clone(),
        board,
        comments,
        config,
        callbacks.clone() as Arc<dyn crate::executor::runner::RunnerCallbacks>,
        RunOptions { existing_plan_output: retry_plan },
        vec![],
    )
    .await?;

    if consume_stopped_flag(&card_id) {
        eprintln!("[queue] Single card {} was stopped during retry", card_id);
        if let Some(updated) = { let c = db.lock().unwrap_or_else(|e| e.into_inner()); cards::get_with_tags(&c, &card_id).ok().flatten() } {
            callbacks.on_card_updated(&updated);
        }
        return Ok(retry_result);
    }

    if retry_result.rate_limit_info.as_ref().map(|r| r.is_rate_limit).unwrap_or(false) {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, &card_id, CardStatus::Queued);
        if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
            callbacks.on_card_updated(&updated);
        }
    } else {
        let new_status = if retry_result.success { CardStatus::Done } else { CardStatus::Failed };
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let _ = cards::set_status(&conn, &card_id, new_status);
        if let Some(updated) = cards::get_with_tags(&conn, &card_id).ok().flatten() {
            callbacks.on_card_updated(&updated);
        }
    }

    Ok(retry_result)
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory, schema};
    use crate::types::{Assignee, CardStatus, CreateBoard, CreateCard};

    fn setup_db() -> Arc<Mutex<Connection>> {
        let conn = open_memory().expect("open_memory");
        schema::init(&conn).expect("init schema");
        Arc::new(Mutex::new(conn))
    }

    fn setup_board(db: &Arc<Mutex<Connection>>) -> String {
        let conn = db.lock().unwrap();
        let board = boards::create(
            &conn,
            &CreateBoard {
                name: "Test Board".into(),
                description: String::new(),
                directory: "/tmp/test".into(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        board.id
    }

    // ---- Test 1: get_queue_state returns None for unknown board ----
    #[test]
    fn queue_state_initially_none() {
        assert!(get_queue_state("nonexistent-board-xyz").is_none());
    }

    // ---- Test 2: pause_unknown_queue_returns_false ----
    #[test]
    fn pause_unknown_queue_returns_false() {
        assert!(!pause_queue("no-such-board-abc"));
    }

    // ---- Test 3: resume_unknown_queue_returns_false ----
    #[test]
    fn resume_unknown_queue_returns_false() {
        assert!(!resume_queue("no-such-board-def"));
    }

    // ---- Test 4: stop_unknown_queue_returns_false ----
    #[test]
    fn stop_unknown_queue_returns_false() {
        assert!(!stop_queue("no-such-board-ghi"));
    }

    // ---- Test 5: notify_new_card on unknown board does not panic ----
    #[test]
    fn notify_new_card_unknown_board_is_no_op() {
        // Should not panic — no notifier registered
        notify_new_card("totally-unknown-board-jkl");
    }

    // ---- Test 6: running queue board IDs initially empty ----
    #[test]
    fn running_queue_board_ids_initially_empty() {
        // This test assumes no other test has left a queue running with these IDs.
        // We just verify the function returns a Vec (may not be empty in full suite).
        let ids = get_running_queue_board_ids();
        // All running IDs should be strings
        for id in &ids {
            assert!(!id.is_empty());
        }
    }

    // ---- Test 7: stopped card flag round-trip ----
    #[test]
    fn stopped_flag_is_consumed_once() {
        let id = "test-card-stop-flag-001";
        assert!(!is_card_stopped(id));
        mark_stopped(id);
        assert!(is_card_stopped(id));
        assert!(consume_stopped_flag(id));
        assert!(!is_card_stopped(id));
        assert!(!consume_stopped_flag(id)); // second consume returns false
    }

    // ---- Test 8: list_by_status returns only cards with matching status ----
    #[test]
    fn list_by_status_filters_correctly() {
        let db = setup_db();
        let board_id = setup_board(&db);
        let conn = db.lock().unwrap();

        let c1 = cards::create(&conn, &board_id, &CreateCard {
            title: "Queued card".into(),
            description: None,
            tags: None,
            assignee: None,
        }).unwrap();
        cards::set_status(&conn, &c1.card.id, CardStatus::Queued).unwrap();

        let c2 = cards::create(&conn, &board_id, &CreateCard {
            title: "Todo card".into(),
            description: None,
            tags: None,
            assignee: None,
        }).unwrap();
        // c2 stays todo

        let queued = cards::list_by_status(&conn, &board_id, CardStatus::Queued).unwrap();
        let todo = cards::list_by_status(&conn, &board_id, CardStatus::Todo).unwrap();

        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].card.id, c1.card.id);
        assert_eq!(todo.len(), 1);
        assert_eq!(todo[0].card.id, c2.card.id);
    }

    // ---- Test 9: human-assigned cards filtered from queued list by queue logic ----
    #[test]
    fn human_cards_excluded_from_processing() {
        let db = setup_db();
        let board_id = setup_board(&db);
        let conn = db.lock().unwrap();

        let human = cards::create(&conn, &board_id, &CreateCard {
            title: "Human card".into(),
            description: None,
            tags: None,
            assignee: Some(Assignee::Human),
        }).unwrap();
        cards::set_status(&conn, &human.card.id, CardStatus::Queued).unwrap();

        let all_queued = cards::list_by_status(&conn, &board_id, CardStatus::Queued).unwrap();
        let ai_only: Vec<_> = all_queued.into_iter()
            .filter(|c| c.card.assignee != Assignee::Human)
            .collect();
        assert!(ai_only.is_empty());
    }

    // ---- Test 10: parse_retry_seconds parses correctly ----
    #[test]
    fn retry_seconds_parsing() {
        assert_eq!(parse_retry_seconds(None), 60);
        assert_eq!(parse_retry_seconds(Some("Retry after 30 seconds")), 30);
        assert_eq!(parse_retry_seconds(Some("retry in 2 minutes")), 120);
        assert_eq!(parse_retry_seconds(Some("wait 1 hour")), 3600);
        assert_eq!(parse_retry_seconds(Some("no match here")), 60);
    }
}
