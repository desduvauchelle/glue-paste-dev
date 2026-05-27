use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use super::{
    idle_detector::detect_idle,
    permission_detector::{detect_permission_prompt, ACCEPT_INPUT},
};

/// Maximum number of trailing bytes of output buffered per session for permission detection.
const BUFFER_TAIL: usize = 8000;

/// Default max sessions before LRU eviction.
const DEFAULT_MAX_SESSIONS: usize = 12;

#[derive(Debug, Clone, PartialEq)]
pub enum PermissionMode {
    AlwaysAsk,
    AlwaysAuto,
    AutoUnlessWatching,
}

impl Default for PermissionMode {
    fn default() -> Self {
        PermissionMode::AutoUnlessWatching
    }
}

pub struct OpenOptions {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    /// Override the default launch command for this specific session.
    pub command: Option<Vec<String>>,
    /// If set, hub delivers this text via bracketed paste and submits it after `initial_input_delay_ms`.
    pub initial_input: Option<String>,
}

pub struct TerminalHubOptions {
    pub permission_mode: PermissionMode,
    /// Called with every output chunk.
    pub on_output: Arc<dyn Fn(&str, &str) + Send + Sync>,
    /// Called when the child process exits.
    pub on_exit: Arc<dyn Fn(&str, i32) + Send + Sync>,
    /// Called when session transitions to idle.
    pub on_idle: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Called when session transitions back to busy.
    pub on_busy: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// Called when permission prompt appears (true) or clears (false).
    pub on_permission_pending: Option<Arc<dyn Fn(&str, bool) + Send + Sync>>,
    /// Delay before auto-answering when unwatched (ms). Default 1500.
    pub grace_ms: Option<u64>,
    /// A heartbeat counts as "watching" for this long (ms). Default 6000.
    pub watch_window_ms: Option<u64>,
    /// Delay before writing `\r` after initial input (ms). Default 300.
    pub initial_input_delay_ms: Option<u64>,
    /// Maximum sessions before LRU eviction. Default 12.
    pub max_sessions: Option<usize>,
}

struct SessionEntry {
    write_fn: Box<dyn Fn(&str) + Send>,
    resize_fn: Box<dyn Fn(u16, u16) + Send>,
    kill_fn: Box<dyn Fn() + Send>,
    get_scrollback_fn: Box<dyn Fn() -> String + Send>,
    is_running_fn: Box<dyn Fn() -> bool + Send>,

    subscribers: HashMap<String, Option<Instant>>, // clientId → last heartbeat
    buffer: String,
    was_idle: bool,
    idle_detection_active: bool,
    last_activity: Instant,
    permission_pending: bool,
    turn_end_senders: Vec<tokio::sync::oneshot::Sender<TurnEndResult>>,
}

#[derive(Debug, Clone)]
pub enum TurnEndResult {
    Idle,
    Exit { code: i32 },
}

struct HubState {
    sessions: HashMap<String, SessionEntry>,
    permission_mode: PermissionMode,
    grace_ms: u64,
    watch_window_ms: u64,
    initial_input_delay_ms: u64,
    max_sessions: usize,
    on_output: Arc<dyn Fn(&str, &str) + Send + Sync>,
    on_exit: Arc<dyn Fn(&str, i32) + Send + Sync>,
    on_idle: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    on_busy: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    on_permission_pending: Option<Arc<dyn Fn(&str, bool) + Send + Sync>>,
}

/// Manages per-card interactive terminal sessions.
///
/// This is the Rust port of the TypeScript `TerminalHub`.
pub struct TerminalHub {
    state: Arc<Mutex<HubState>>,
}

/// Data callbacks injected into each PTY session (on_data / on_exit).
pub struct SessionCallbacks {
    pub on_data: Box<dyn Fn(String) + Send + 'static>,
    pub on_exit: Box<dyn Fn(i32) + Send + 'static>,
}

impl TerminalHub {
    pub fn new(opts: TerminalHubOptions) -> Self {
        Self {
            state: Arc::new(Mutex::new(HubState {
                sessions: HashMap::new(),
                permission_mode: opts.permission_mode,
                grace_ms: opts.grace_ms.unwrap_or(1500),
                watch_window_ms: opts.watch_window_ms.unwrap_or(6000),
                initial_input_delay_ms: opts.initial_input_delay_ms.unwrap_or(300),
                max_sessions: opts.max_sessions.unwrap_or(DEFAULT_MAX_SESSIONS),
                on_output: opts.on_output,
                on_exit: opts.on_exit,
                on_idle: opts.on_idle,
                on_busy: opts.on_busy,
                on_permission_pending: opts.on_permission_pending,
            })),
        }
    }

    /// Build the `on_data` / `on_exit` callbacks for a new PTY session for `card_id`.
    ///
    /// Must be called before `open()`. Pass the returned `SessionCallbacks` to your PTY spawn code,
    /// then pass the resulting session vtable to `open()`.
    pub fn make_session_callbacks(&self, card_id: &str) -> SessionCallbacks {
        let state_data = Arc::clone(&self.state);
        let state_exit = Arc::clone(&self.state);
        let card_id_data = card_id.to_string();
        let card_id_exit = card_id.to_string();

        SessionCallbacks {
            on_data: Box::new(move |chunk| {
                Self::handle_data_inner(&state_data, &card_id_data, &chunk);
            }),
            on_exit: Box::new(move |code| {
                Self::handle_exit_inner(&state_exit, &card_id_exit, code);
            }),
        }
    }

    /// Register an already-spawned session. Call after `make_session_callbacks` + PTY spawn.
    pub fn open(
        &self,
        card_id: &str,
        opts: OpenOptions,
        write_fn: Box<dyn Fn(&str) + Send>,
        resize_fn: Box<dyn Fn(u16, u16) + Send>,
        kill_fn: Box<dyn Fn() + Send>,
        get_scrollback_fn: Box<dyn Fn() -> String + Send>,
        is_running_fn: Box<dyn Fn() -> bool + Send>,
    ) {
        let mut hub = self.state.lock().unwrap();

        if hub.sessions.contains_key(card_id) {
            return;
        }

        // LRU eviction: close the oldest idle+unwatched session if at capacity
        if hub.sessions.len() >= hub.max_sessions {
            let watch_window = hub.watch_window_ms;
            let victim = hub
                .sessions
                .iter()
                .filter(|(_, e)| e.was_idle && !Self::is_watched_entry_inner(e, watch_window))
                .min_by_key(|(_, e)| e.last_activity)
                .map(|(id, _)| id.clone());
            if let Some(v) = victim {
                Self::close_entry_inner(&mut hub.sessions, &v);
            }
        }

        let has_initial_input = opts.initial_input.is_some();

        let entry = SessionEntry {
            write_fn,
            resize_fn,
            kill_fn,
            get_scrollback_fn,
            is_running_fn,
            subscribers: HashMap::new(),
            buffer: String::new(),
            was_idle: false,
            idle_detection_active: !has_initial_input,
            last_activity: Instant::now(),
            permission_pending: false,
            turn_end_senders: Vec::new(),
        };
        hub.sessions.insert(card_id.to_string(), entry);

        if let Some(initial_input) = opts.initial_input {
            let e = hub.sessions.get(card_id).unwrap();
            let bracketed = format!("\x1b[200~{initial_input}\x1b[201~");
            (e.write_fn)(&bracketed);

            let state2 = Arc::clone(&self.state);
            let card_id_owned = card_id.to_string();
            let delay = hub.initial_input_delay_ms;
            drop(hub);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                let mut h = state2.lock().unwrap();
                if let Some(e) = h.sessions.get_mut(&card_id_owned) {
                    e.idle_detection_active = true;
                    (e.write_fn)("\r");
                }
            });
        }
    }

    pub fn attach(&self, client_id: &str, card_id: &str) {
        let mut hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get_mut(card_id) {
            e.subscribers.insert(client_id.to_string(), None);
        }
    }

    pub fn detach(&self, client_id: &str, card_id: &str) {
        let mut hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get_mut(card_id) {
            e.subscribers.remove(client_id);
        }
    }

    pub fn detach_client_everywhere(&self, client_id: &str) {
        let mut hub = self.state.lock().unwrap();
        for e in hub.sessions.values_mut() {
            e.subscribers.remove(client_id);
        }
    }

    pub fn heartbeat(&self, client_id: &str, card_id: &str) {
        let mut hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get_mut(card_id) {
            e.subscribers.insert(client_id.to_string(), Some(Instant::now()));
        }
    }

    pub fn is_watched(&self, card_id: &str) -> bool {
        let hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get(card_id) {
            Self::is_watched_entry_inner(e, hub.watch_window_ms)
        } else {
            false
        }
    }

    fn is_watched_entry_inner(e: &SessionEntry, watch_window_ms: u64) -> bool {
        let window = Duration::from_millis(watch_window_ms);
        e.subscribers
            .values()
            .any(|ts| ts.map(|t| t.elapsed() <= window).unwrap_or(false))
    }

    pub fn input(&self, card_id: &str, data: &str) {
        let hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get(card_id) {
            if e.permission_pending {
                // User is answering a permission prompt — clear it
                let on_perm = hub.on_permission_pending.clone();
                drop(hub);
                {
                    let mut hub2 = self.state.lock().unwrap();
                    if let Some(e2) = hub2.sessions.get_mut(card_id) {
                        e2.permission_pending = false;
                        e2.buffer.clear();
                        (e2.write_fn)(data);
                    }
                }
                if let Some(cb) = on_perm {
                    cb(card_id, false);
                }
                return;
            }
            (e.write_fn)(data);
        }
    }

    pub fn interrupt(&self, card_id: &str) {
        let hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get(card_id) {
            (e.write_fn)("\x03");
        }
    }

    pub fn resize(&self, card_id: &str, cols: u16, rows: u16) {
        let hub = self.state.lock().unwrap();
        if let Some(e) = hub.sessions.get(card_id) {
            (e.resize_fn)(cols, rows);
        }
    }

    pub fn get_scrollback(&self, card_id: &str) -> String {
        let hub = self.state.lock().unwrap();
        hub.sessions
            .get(card_id)
            .map(|e| (e.get_scrollback_fn)())
            .unwrap_or_default()
    }

    pub fn is_running(&self, card_id: &str) -> bool {
        let hub = self.state.lock().unwrap();
        hub.sessions
            .get(card_id)
            .map(|e| (e.is_running_fn)())
            .unwrap_or(false)
    }

    /// Async wait for the current turn to end (idle or exit).
    pub async fn wait_for_turn_end(&self, card_id: &str) -> TurnEndResult {
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut hub = self.state.lock().unwrap();
            match hub.sessions.get_mut(card_id) {
                Some(e) => e.turn_end_senders.push(tx),
                None => {
                    let _ = tx.send(TurnEndResult::Exit { code: -1 });
                }
            }
        }
        rx.await.unwrap_or(TurnEndResult::Exit { code: -1 })
    }

    pub fn close(&self, card_id: &str) {
        let mut hub = self.state.lock().unwrap();
        Self::close_entry_inner(&mut hub.sessions, card_id);
    }

    pub fn close_all(&self) {
        let mut hub = self.state.lock().unwrap();
        let ids: Vec<String> = hub.sessions.keys().cloned().collect();
        for id in ids {
            Self::close_entry_inner(&mut hub.sessions, &id);
        }
    }

    fn close_entry_inner(sessions: &mut HashMap<String, SessionEntry>, card_id: &str) {
        if let Some(e) = sessions.remove(card_id) {
            (e.kill_fn)();
            for tx in e.turn_end_senders {
                let _ = tx.send(TurnEndResult::Exit { code: -1 });
            }
        }
    }

    fn handle_data_inner(state: &Arc<Mutex<HubState>>, card_id: &str, chunk: &str) {
        // Fire on_output without holding the lock
        let on_output = {
            let h = state.lock().unwrap();
            Arc::clone(&h.on_output)
        };
        on_output(card_id, chunk);

        // Update buffer and permission state
        let (permission_changed, new_pending, on_perm_cb) = {
            let mut hub = state.lock().unwrap();
            let e = match hub.sessions.get_mut(card_id) {
                Some(e) => e,
                None => return,
            };
            e.last_activity = Instant::now();
            e.buffer.push_str(chunk);
            let len = e.buffer.len();
            if len > BUFFER_TAIL {
                e.buffer = e.buffer[len - BUFFER_TAIL..].to_string();
            }

            let prompt_now = detect_permission_prompt(&e.buffer).is_some();
            let changed = prompt_now != e.permission_pending;
            if changed {
                e.permission_pending = prompt_now;
            }
            (changed, prompt_now, hub.on_permission_pending.clone())
        };

        if permission_changed {
            if let Some(cb) = on_perm_cb {
                cb(card_id, new_pending);
            }
        }

        // Maybe auto-answer permission (spawns async task, doesn't block)
        Self::maybe_handle_permission(state, card_id);

        // Idle detection
        let (idle_active, was_idle, idle_cb, busy_cb) = {
            let hub = state.lock().unwrap();
            let e = match hub.sessions.get(card_id) {
                Some(e) => e,
                None => return,
            };
            (e.idle_detection_active, e.was_idle, hub.on_idle.clone(), hub.on_busy.clone())
        };

        if idle_active {
            let is_idle = detect_idle(chunk);
            if is_idle && !was_idle {
                let waiters = {
                    let mut hub = state.lock().unwrap();
                    if let Some(e) = hub.sessions.get_mut(card_id) {
                        e.was_idle = true;
                        e.turn_end_senders.drain(..).collect::<Vec<_>>()
                    } else {
                        vec![]
                    }
                };
                for tx in waiters {
                    let _ = tx.send(TurnEndResult::Idle);
                }
                if let Some(cb) = idle_cb {
                    cb(card_id);
                }
            } else if !is_idle && was_idle {
                {
                    let mut hub = state.lock().unwrap();
                    if let Some(e) = hub.sessions.get_mut(card_id) {
                        e.was_idle = false;
                    }
                }
                if let Some(cb) = busy_cb {
                    cb(card_id);
                }
            }
        }
    }

    fn handle_exit_inner(state: &Arc<Mutex<HubState>>, card_id: &str, code: i32) {
        let (on_exit, waiters) = {
            let mut hub = state.lock().unwrap();
            let waiters = hub
                .sessions
                .get_mut(card_id)
                .map(|e| e.turn_end_senders.drain(..).collect::<Vec<_>>())
                .unwrap_or_default();
            hub.sessions.remove(card_id);
            (Arc::clone(&hub.on_exit), waiters)
        };
        on_exit(card_id, code);
        for tx in waiters {
            let _ = tx.send(TurnEndResult::Exit { code });
        }
    }

    fn maybe_handle_permission(state: &Arc<Mutex<HubState>>, card_id: &str) {
        let (permission_mode, match_found, grace_ms, is_watched) = {
            let hub = state.lock().unwrap();
            let e = match hub.sessions.get(card_id) {
                Some(e) => e,
                None => return,
            };
            let match_found = detect_permission_prompt(&e.buffer).is_some();
            let is_watched = Self::is_watched_entry_inner(e, hub.watch_window_ms);
            (hub.permission_mode.clone(), match_found, hub.grace_ms, is_watched)
        };

        if permission_mode == PermissionMode::AlwaysAsk || !match_found {
            return;
        }

        if permission_mode == PermissionMode::AlwaysAuto {
            let state2 = Arc::clone(state);
            let card_id = card_id.to_string();
            tokio::spawn(async move {
                let hub = state2.lock().unwrap();
                if let Some(e) = hub.sessions.get(&card_id) {
                    let scrollback = (e.get_scrollback_fn)();
                    if detect_permission_prompt(&scrollback).is_some() {
                        (e.write_fn)(ACCEPT_INPUT);
                        drop(hub);
                        if let Some(e2) = state2.lock().unwrap().sessions.get_mut(&card_id) {
                            e2.buffer.clear();
                        }
                    }
                }
            });
            return;
        }

        // auto-unless-watching
        if is_watched {
            return;
        }

        let state2 = Arc::clone(state);
        let card_id = card_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(grace_ms)).await;
            let hub = state2.lock().unwrap();
            if let Some(e) = hub.sessions.get(&card_id) {
                let still_watched = Self::is_watched_entry_inner(e, hub.watch_window_ms);
                if still_watched {
                    return;
                }
                let scrollback = (e.get_scrollback_fn)();
                if detect_permission_prompt(&scrollback).is_some() {
                    (e.write_fn)(ACCEPT_INPUT);
                    drop(hub);
                    if let Some(e2) = state2.lock().unwrap().sessions.get_mut(&card_id) {
                        e2.buffer.clear();
                    }
                }
            }
        });
    }
}
