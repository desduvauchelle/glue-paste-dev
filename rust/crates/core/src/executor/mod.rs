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

pub mod cli_adapter;
pub use cli_adapter::{build_cli_command, CliCommand, CliConfig, CliAdapterError};

pub mod prompt;
pub use prompt::{build_prompt, PromptContext, PromptConfig};

pub mod execution_logger;
pub use execution_logger::{execution_log_path, write_execution_log, write_execution_log_raw};
