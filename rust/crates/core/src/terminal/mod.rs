pub mod permission_detector;
pub mod idle_detector;
pub mod pty_session;
pub mod terminal_hub;

pub use permission_detector::detect_permission_prompt;
pub use idle_detector::detect_idle;
pub use pty_session::{PtySession, PtySessionOptions};
pub use terminal_hub::{
    TerminalHub, TerminalHubOptions, OpenOptions, PermissionMode, TurnEndResult, SessionCallbacks,
};
