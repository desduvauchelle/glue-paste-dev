// Phase 2 modules populated by per-module tasks.

pub mod fresh_env;
pub use fresh_env::get_fresh_env;

pub mod rate_limit;
pub use rate_limit::{detect_rate_limit, RateLimitInfo};

pub mod git_errors;
pub use git_errors::{detect_git_error, GitErrorInfo};

pub mod process_cleanup;
pub use process_cleanup::kill_process_tree;

pub mod stream_parser;
pub use stream_parser::{parse_stream_line, ParsedStreamEvent, StreamEventKind};

pub mod extract_report;
pub use extract_report::{
    parse_report_json, write_report_file, extract_plan_report, extract_execute_report,
    PlanReport, ExecuteReport, PlanSummary, Blocker, CriterionResult,
    PlanReportArgs, ExecuteReportArgs, FileChange, CriterionInput,
};
