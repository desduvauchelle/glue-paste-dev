//! executor/runner.rs — port of packages/core/src/executor/runner.ts
//!
//! Two-phase plan+execute cycle for a single card.
//!
//! CONCERNS (simplifications vs the Bun source):
//! 1. `existingPlanOutput` short-circuit: if `RunOptions::existing_plan_output` is Some,
//!    we skip the plan phase and use it as the plan text. Behaviour matches TS.
//! 2. `extractPlanReport` / `extractExecuteReport`: called best-effort; failures are
//!    logged and ignored (same as TS "never fails the card"). The Haiku subprocess may
//!    not be available in CI — that is expected.
//! 3. `writeReportFile`: called inside the proof-extraction block; swallows errors same
//!    as TS.
//! 4. `planModel` / `executeModel` per-card overrides: not present in `RunnerConfig`
//!    (the TS `Required<ConfigInput>` exposes them). Runner uses a single `model` field
//!    and the thinking-level default table, matching the TS fallback path. Add
//!    `plan_model`/`execute_model` fields to `RunnerConfig` in Phase 4 if needed.
//! 5. Branch checkout (branchMode="new"/"specific"): ported faithfully.
//! 6. Stderr is collected in a background task and joined after stdout EOF, because
//!    tokio does not provide a combined reader. This differs from the Bun streaming
//!    approach but produces the same final result.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;

use rusqlite::Connection;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::db::{cards, comments, commits, criteria, executions};
use crate::executor::{
    build_cli_command, build_prompt, extract_execute_report, extract_plan_report, get_fresh_env,
    kill_process_tree, parse_stream_line, write_report_file, CliAdapterError, CliConfig,
    ExecuteReportArgs, FileChange as ExtractFileChange, PlanReportArgs,
    PromptConfig, PromptContext, StreamEventKind, CriterionInput,
};
use crate::types::{
    Assignee, Board, CardStatus, CardWithTags, Comment, ExecutionPhase, ExecutionStatus,
};
use crate::Result;

// ---------------------------------------------------------------------------
// Public config / option / result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RunnerConfig {
    pub cli_provider: String,
    pub model: String,
    pub max_budget_usd: f64,
    pub cli_custom_command: String,
    /// "smart" | "basic" | "" (empty = skip plan phase, run execute only)
    pub plan_thinking: String,
    /// "smart" | "basic"
    pub execute_thinking: String,
    pub custom_instructions: String,
    pub auto_commit: bool,
    pub auto_push: bool,
    pub branch_mode: String, // "current" | "new" | "specific"
    pub branch_name: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RunOptions {
    /// If Some, skip the plan phase and use this text as the plan output.
    pub existing_plan_output: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RunResult {
    pub success: bool,
    pub exit_code: i32,
    pub output: String,
    pub rate_limit_info: Option<crate::executor::RateLimitInfo>,
}

// ---------------------------------------------------------------------------
// Callbacks trait
// ---------------------------------------------------------------------------

pub trait RunnerCallbacks: Send + Sync {
    fn on_execution_started(&self, card_id: &str, execution_id: &str, phase: ExecutionPhase);
    fn on_output(&self, execution_id: &str, chunk: &str);
    fn on_execution_completed(
        &self,
        execution_id: &str,
        status: &str,
        exit_code: i32,
        error_summary: Option<&str>,
    );
    fn on_card_updated(&self, card: &CardWithTags);
    fn on_comment_added(&self, comment: &Comment);
}

// ---------------------------------------------------------------------------
// Process registry
// ---------------------------------------------------------------------------

struct ActiveProcess {
    pid: u32,
    #[allow(dead_code)]
    execution_id: String,
}

static ACTIVE_CARD_PROCESSES: LazyLock<Mutex<HashMap<String, ActiveProcess>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Returns `true` if there is an active runner process for the given card.
pub fn get_active_card_process(card_id: &str) -> bool {
    let map = ACTIVE_CARD_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
    map.contains_key(card_id)
}

/// Kills the active runner process for a card. Returns `true` if killed.
pub fn kill_card_process(card_id: &str) -> bool {
    let entry = {
        let mut map = ACTIVE_CARD_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(card_id)
    };
    if let Some(p) = entry {
        kill_process_tree(p.pid as i32);
        true
    } else {
        false
    }
}

/// Kills all active runner processes.
pub fn kill_all_card_processes() {
    let entries: Vec<(String, ActiveProcess)> = {
        let mut map = ACTIVE_CARD_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.drain().collect()
    };
    for (_card_id, p) in entries {
        kill_process_tree(p.pid as i32);
    }
}

// ---------------------------------------------------------------------------
// Model resolution helpers
// ---------------------------------------------------------------------------

fn resolve_model(_phase: &str, thinking_level: &str, config_model: &str) -> String {
    if !config_model.is_empty() {
        return config_model.to_string();
    }
    match thinking_level {
        "smart" => "claude-opus-4-6".to_string(),
        "basic" => "claude-sonnet-4-6".to_string(),
        _ => "claude-opus-4-6".to_string(),
    }
}

// ---------------------------------------------------------------------------
// run_card — top-level entry point
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub async fn run_card(
    db: Arc<Mutex<Connection>>,
    card: CardWithTags,
    board: Board,
    comments: Vec<Comment>,
    config: RunnerConfig,
    callbacks: Arc<dyn RunnerCallbacks>,
    options: RunOptions,
    card_files: Vec<String>,
) -> Result<RunResult> {
    // Human-assignee bail-out — must not run
    if card.card.assignee == Assignee::Human {
        return Ok(RunResult {
            success: true,
            exit_code: 0,
            output: String::new(),
            rate_limit_info: None,
        });
    }

    // Concurrency guard
    if get_active_card_process(&card.card.id) {
        return Ok(RunResult {
            success: true,
            exit_code: 0,
            output: String::new(),
            rate_limit_info: None,
        });
    }

    // Mark card in-progress
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        cards::set_status(&conn, &card.card.id, CardStatus::InProgress)?;
        if let Some(updated) = cards::get_with_tags(&conn, &card.card.id)? {
            callbacks.on_card_updated(&updated);
        }
    }

    // Branch checkout if configured
    checkout_branch_if_needed(&board.directory, &config).await;

    // Single session for both phases so execute inherits plan context
    let session_id = Uuid::new_v4().to_string();

    let has_plan = !config.plan_thinking.is_empty();

    let result: RunResult;

    if has_plan {
        let existing_plan = options.existing_plan_output.clone();

        let plan_output_text: String = if let Some(plan_text) = existing_plan {
            // Reuse existing plan — skip plan phase
            plan_text
        } else {
            // Phase 1: Plan
            let plan_model = resolve_model("plan", &config.plan_thinking, &config.model);
            let plan_config = RunnerConfig {
                model: plan_model,
                ..config.clone()
            };
            let plan_result = execute_phase(
                db.clone(),
                &card,
                &board,
                &comments,
                &plan_config,
                ExecutionPhase::Plan,
                callbacks.clone(),
                &session_id,
                false,
                None,
                &card_files,
            )
            .await?;

            if !plan_result.success {
                return Ok(plan_result);
            }

            // Guard: abort if card was completed by concurrent invocation
            let mid_card = {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                cards::get_with_tags(&conn, &card.card.id)?
            };
            if mid_card.as_ref().map(|c| &c.card.status) != Some(&CardStatus::InProgress) {
                return Ok(RunResult {
                    success: true,
                    exit_code: 0,
                    output: plan_result.output.clone(),
                    rate_limit_info: None,
                });
            }

            plan_result.output
        };

        // Phase 2: Execute with plan context
        let exec_model = resolve_model(
            "execute",
            if config.execute_thinking.is_empty() { "smart" } else { &config.execute_thinking },
            &config.model,
        );
        let exec_config = RunnerConfig {
            model: exec_model,
            ..config.clone()
        };
        let exec_result = execute_phase(
            db.clone(),
            &card,
            &board,
            &comments,
            &exec_config,
            ExecutionPhase::Execute,
            callbacks.clone(),
            &session_id,
            true,
            Some(&plan_output_text),
            &card_files,
        )
        .await?;

        result = RunResult {
            output: exec_result.output.chars().rev().take(1024).collect::<String>().chars().rev().collect(),
            ..exec_result
        };
    } else {
        // Single phase: execute directly
        let exec_model = resolve_model(
            "execute",
            if config.execute_thinking.is_empty() { "smart" } else { &config.execute_thinking },
            &config.model,
        );
        let exec_config = RunnerConfig {
            model: exec_model,
            ..config.clone()
        };
        result = execute_phase(
            db.clone(),
            &card,
            &board,
            &comments,
            &exec_config,
            ExecutionPhase::Execute,
            callbacks.clone(),
            &session_id,
            false,
            None,
            &card_files,
        )
        .await?;
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Branch checkout helper
// ---------------------------------------------------------------------------

async fn checkout_branch_if_needed(directory: &str, config: &RunnerConfig) {
    let mode = config.branch_mode.as_str();
    if mode != "new" && mode != "specific" {
        return;
    }

    let target_branch: Option<String> = if mode == "new" {
        Some(format!(
            "glue-paste/{}-{}",
            config.branch_name.as_deref().unwrap_or("card"),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        ))
    } else {
        config.branch_name.clone()
    };

    let Some(branch) = target_branch else { return };

    if mode == "new" {
        let _ = Command::new("git")
            .args(["checkout", "-b", &branch])
            .current_dir(directory)
            .output()
            .await;
    } else {
        // Try checkout existing; create if missing
        let check = Command::new("git")
            .args(["checkout", &branch])
            .current_dir(directory)
            .output()
            .await;
        if check.map(|o| !o.status.success()).unwrap_or(true) {
            let _ = Command::new("git")
                .args(["checkout", "-b", &branch])
                .current_dir(directory)
                .output()
                .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async fn git_head_sha(cwd: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(cwd)
        .output()
        .await
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    } else {
        None
    }
}

struct NewCommitInfo {
    sha: String,
    message: String,
    author_name: String,
    author_email: String,
    files_changed: Vec<FileChangeInfo>,
}

struct FileChangeInfo {
    path: String,
    additions: i64,
    deletions: i64,
}

async fn capture_file_changes(cwd: &str, sha_before: &str) -> Vec<FileChangeInfo> {
    let out = Command::new("git")
        .args(["diff", "--numstat", sha_before])
        .current_dir(cwd)
        .output()
        .await;
    let Ok(out) = out else { return vec![] };
    if !out.status.success() { return vec![]; }
    parse_numstat(&String::from_utf8_lossy(&out.stdout))
}

fn parse_numstat(output: &str) -> Vec<FileChangeInfo> {
    let mut files = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 { continue; }
        let additions: i64 = if parts[0] == "-" { 0 } else { parts[0].parse().unwrap_or(0) };
        let deletions: i64 = if parts[1] == "-" { 0 } else { parts[1].parse().unwrap_or(0) };
        files.push(FileChangeInfo {
            path: parts[2].to_string(),
            additions,
            deletions,
        });
    }
    files
}

async fn capture_new_commits(cwd: &str, sha_before: &str) -> Vec<NewCommitInfo> {
    let out = Command::new("git")
        .args([
            "log",
            &format!("{}..HEAD", sha_before),
            "--format=%H%n%s%n%an%n%ae%n---END---",
            "--reverse",
        ])
        .current_dir(cwd)
        .output()
        .await;
    let Ok(out) = out else { return vec![] };
    if !out.status.success() { return vec![]; }

    let text = String::from_utf8_lossy(&out.stdout);
    if text.trim().is_empty() { return vec![]; }

    let mut commits = Vec::new();
    for entry in text.trim().split("---END---\n") {
        let entry = entry.trim();
        if entry.is_empty() { continue; }
        let lines: Vec<&str> = entry.lines().collect();
        if lines.len() < 4 { continue; }
        let sha = lines[0].to_string();
        let message = lines[1].to_string();
        let author_name = lines[2].to_string();
        let author_email = lines[3].to_string();

        // Per-commit file changes
        let diff_out = Command::new("git")
            .args(["diff", "--numstat", &format!("{}~1", sha), &sha])
            .current_dir(cwd)
            .output()
            .await;
        let files_changed = if let Ok(d) = diff_out {
            parse_numstat(&String::from_utf8_lossy(&d.stdout))
        } else {
            vec![]
        };

        commits.push(NewCommitInfo { sha, message, author_name, author_email, files_changed });
    }
    commits
}

// ---------------------------------------------------------------------------
// executePhase
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn execute_phase(
    db: Arc<Mutex<Connection>>,
    card: &CardWithTags,
    board: &Board,
    comments_list: &[Comment],
    config: &RunnerConfig,
    phase: ExecutionPhase,
    callbacks: Arc<dyn RunnerCallbacks>,
    session_id: &str,
    resume: bool,
    plan_output: Option<&str>,
    card_files: &[String],
) -> Result<RunResult> {
    let phase_name = match phase {
        ExecutionPhase::Plan => "Plan",
        ExecutionPhase::Execute => "Execution",
    };

    // Resolve attachment paths
    let attach_dir = Path::new(&board.directory)
        .join(".glue-paste")
        .join("attachments")
        .join(&card.card.id);
    let attachment_paths: Vec<String> = std::fs::read_dir(&attach_dir)
        .ok()
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .map(|name| format!(".glue-paste/attachments/{}/{}", card.card.id, name))
                .collect()
        })
        .unwrap_or_default();

    // Fetch criteria for execute phase
    let criteria_for_prompt = if matches!(phase, ExecutionPhase::Execute) {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        criteria::list_for_card(&conn, &card.card.id).unwrap_or_default()
    } else {
        vec![]
    };

    // Build prompt
    let prompt_config = PromptConfig {
        custom_instructions: config.custom_instructions.clone(),
        auto_commit: config.auto_commit,
        auto_push: config.auto_push,
        branch_mode: config.branch_mode.clone(),
    };
    let prompt = build_prompt(&PromptContext {
        card,
        board,
        comments: comments_list,
        config: &prompt_config,
        phase: phase.clone(),
        plan_output,
        attachment_paths: &attachment_paths,
        criteria: &criteria_for_prompt,
        files: card_files,
    });

    // Create execution record
    let execution = {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::create_execution(&conn, &card.card.id, session_id, phase.clone())?
    };

    callbacks.on_execution_started(&card.card.id, &execution.id, phase.clone());

    // Phase-started system comment
    let phase_started_at = Instant::now();
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        let started_comment = comments::add_system_comment(
            &conn,
            &card.card.id,
            &execution.id,
            &format!("{} started.", phase_name),
        )?;
        callbacks.on_comment_added(&started_comment);
    }

    // Capture git SHA before execute phase
    let sha_before: Option<String> = if matches!(phase, ExecutionPhase::Execute) {
        git_head_sha(&board.directory).await
    } else {
        None
    };

    // Build CLI command
    let cli_config = CliConfig {
        cli_provider: config.cli_provider.clone(),
        model: config.model.clone(),
        max_budget_usd: config.max_budget_usd,
        cli_custom_command: config.cli_custom_command.clone(),
        plan_thinking: config.plan_thinking.clone(),
        execute_thinking: config.execute_thinking.clone(),
    };
    let cli_cmd = build_cli_command(&cli_config, &prompt, session_id, phase.clone(), resume)
        .map_err(|e: CliAdapterError| crate::Error::Io(std::io::Error::other(e.to_string())))?;

    // Spawn subprocess
    let env_map: HashMap<String, String> = get_fresh_env();
    let mut cmd = Command::new(&cli_cmd.args[0]);
    cmd.args(&cli_cmd.args[1..])
        .current_dir(&board.directory)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    for (k, v) in &env_map {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(crate::Error::Io)?;

    // Register PID
    let pid = child.id().unwrap_or(0);
    if pid > 0 {
        {
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            let _ = executions::update_pid(&conn, &execution.id, pid);
        }
        let mut map = ACTIVE_CARD_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(
            card.card.id.clone(),
            ActiveProcess { pid, execution_id: execution.id.clone() },
        );
    }

    // Stream stdout line by line
    const MAX_OUTPUT_MEMORY: usize = 50 * 1024;
    let mut output = String::new();
    let mut cost_usd: f64 = 0.0;
    let supports_stream_json = cli_cmd.supports_stream_json;

    // Collect stderr concurrently using a background task
    let stderr_handle = if let Some(stderr) = child.stderr.take() {
        let handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            let mut buf = String::new();
            const MAX_STDERR: usize = 2048;
            while let Ok(Some(line)) = reader.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
                if buf.len() > MAX_STDERR * 3 / 2 {
                    let keep = buf.len() - MAX_STDERR;
                    buf = buf[keep..].to_string();
                }
            }
            buf
        });
        Some(handle)
    } else {
        None
    };

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        let exec_id = execution.id.clone();
        while let Ok(Some(line)) = reader.next_line().await {
            if supports_stream_json {
                if let Some(event) = parse_stream_line(&line) {
                    match event.kind {
                        StreamEventKind::Text | StreamEventKind::ToolUse => {
                            let chunk = format!("{}\n", event.content);
                            output.push_str(&chunk);
                            callbacks.on_output(&exec_id, &event.content);
                            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                            let _ = executions::append_output(&conn, &exec_id, &chunk);
                        }
                        StreamEventKind::Result => {
                            if let Some(c) = event.cost_usd {
                                cost_usd = c;
                                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                                let _ = executions::update_cost(&conn, &exec_id, c);
                            }
                        }
                        _ => {}
                    }
                }
            } else if !line.trim().is_empty() {
                let chunk = format!("{}\n", line);
                output.push_str(&chunk);
                callbacks.on_output(&exec_id, &line);
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                let _ = executions::append_output(&conn, &exec_id, &chunk);
            }
            // Cap in-memory tail
            if output.len() > MAX_OUTPUT_MEMORY * 3 / 2 {
                let keep = output.len() - MAX_OUTPUT_MEMORY;
                output = output[keep..].to_string();
            }
        }
    }

    let exit_status = child.wait().await.map_err(crate::Error::Io)?;
    let exit_code = exit_status.code().unwrap_or(-1);
    let stderr_output = if let Some(h) = stderr_handle {
        h.await.unwrap_or_default()
    } else {
        String::new()
    };

    // Remove from active map
    {
        let mut map = ACTIVE_CARD_PROCESSES.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&card.card.id);
    }

    let mut success = exit_code == 0;
    let mut status = if success { ExecutionStatus::Success } else { ExecutionStatus::Failed };

    // Update execution status
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::update_status(&conn, &execution.id, status.clone(), Some(exit_code as i64))?;
    }

    // Capture file changes after execute phase
    let mut execute_files_changed: Vec<FileChangeInfo> = vec![];
    let mut no_changes_detected = false;

    if matches!(phase, ExecutionPhase::Execute) {
        if let Some(ref sha) = sha_before {
            let files_changed = capture_file_changes(&board.directory, sha).await;
            execute_files_changed = files_changed;

            // Serialize file changes as JSON for DB storage
            let files_json = serialize_file_changes(&execute_files_changed);
            {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                let _ = executions::update_files_changed(
                    &conn,
                    &execution.id,
                    if files_json.is_empty() { None } else { Some(&files_json) },
                );
            }

            // Detect AI exit 0 but no changes
            let sha_after: Option<String> = if success && execute_files_changed.is_empty() {
                git_head_sha(&board.directory).await
            } else {
                None
            };

            no_changes_detected = should_fail_no_changes(
                &phase,
                exit_code,
                &execute_files_changed,
                sha_before.as_deref(),
                sha_after.as_deref(),
            );

            if no_changes_detected {
                success = false;
                status = ExecutionStatus::Failed;
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                executions::update_status(&conn, &execution.id, ExecutionStatus::Failed, Some(exit_code as i64))?;
            }

            // Capture commits
            let new_commits = capture_new_commits(&board.directory, sha).await;
            if !new_commits.is_empty() {
                let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                for c in &new_commits {
                    let files_json = serialize_file_changes(&c.files_changed);
                    let _ = commits::record(
                        &conn,
                        &commits::NewCommit {
                            card_id: &card.card.id,
                            execution_id: Some(&execution.id),
                            sha: &c.sha,
                            message: &c.message,
                            author_name: &c.author_name,
                            author_email: &c.author_email,
                            files_changed: if files_json.is_empty() { None } else { Some(&files_json) },
                        },
                    );
                }
            }
        }
    }

    // === Proof of work: extract structured artifacts (best-effort) ===
    {
        let card_id = card.card.id.clone();
        let execution_id = execution.id.clone();
        let board_dir = board.directory.clone();
        let card_title = card.card.title.clone();
        let card_description = card.card.description.clone();
        let output_clone = output.clone();
        let files_for_report: Vec<ExtractFileChange> = execute_files_changed
            .iter()
            .map(|f| ExtractFileChange {
                path: f.path.clone(),
                additions: f.additions,
                deletions: f.deletions,
            })
            .collect();

        match phase {
            ExecutionPhase::Plan if success => {
                let args = PlanReportArgs {
                    title: card_title,
                    description: card_description,
                    plan_output: output_clone,
                };
                if let Some(report) = extract_plan_report(&args).await {
                    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                    let _ = criteria::seed_criteria(&conn, &card_id, &report.criteria);
                    let summary_json =
                        serde_json::to_string(&report.plan_summary).unwrap_or_default();
                    let _ = cards::set_plan_summary(&conn, &card_id, Some(&summary_json));
                    drop(conn);
                    write_report_file(&board_dir, &execution_id, &report);
                }
            }
            ExecutionPhase::Execute => {
                if success {
                    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                    let _ = cards::clear_blocker(&conn, &card_id);
                }
                let criteria_for_extract = {
                    let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                    criteria::list_for_card(&conn, &card_id).unwrap_or_default()
                };
                let criterion_inputs: Vec<CriterionInput> = criteria_for_extract
                    .iter()
                    .map(|c| CriterionInput { id: c.id.clone(), text: c.text.clone() })
                    .collect();

                let args = ExecuteReportArgs {
                    title: card_title,
                    description: card_description,
                    criteria: criterion_inputs,
                    output: output_clone,
                    files_changed: files_for_report,
                    exit_code,
                };
                if let Some(report) = extract_execute_report(&args).await {
                    {
                        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                        for r in &report.criteria {
                            let _ = criteria::set_criterion_result(
                                &conn,
                                &r.id,
                                &r.status,
                                &r.evidence,
                                &execution_id,
                            );
                        }
                        if success {
                            let _ = cards::set_completion_summary(
                                &conn,
                                &card_id,
                                Some(&report.completion_summary),
                            );
                        }
                        if !success {
                            if let Some(ref blocker) = report.blocker {
                                let blocker_json =
                                    serde_json::to_string(blocker).unwrap_or_default();
                                let _ = cards::set_blocker(&conn, &card_id, Some(&blocker_json));
                            }
                        }
                    }
                    write_report_file(&board_dir, &execution_id, &report);
                    let passed = report.criteria.iter().filter(|r| r.status == "pass").count();
                    if !report.criteria.is_empty() {
                        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
                        if let Ok(c) = comments::add_system_comment(
                            &conn,
                            &card_id,
                            &execution_id,
                            &format!("Proof: {}/{} criteria passed.", passed, report.criteria.len()),
                        ) {
                            callbacks.on_comment_added(&c);
                        }
                    }
                }
            }
            _ => {}
        }

        // Refresh card and fire on_card_updated
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(Some(refreshed)) = cards::get_with_tags(&conn, &card_id) {
            callbacks.on_card_updated(&refreshed);
        }
    }

    // Summary comment
    let duration_ms = phase_started_at.elapsed().as_millis() as u64;
    let duration_str = format_duration(duration_ms);
    let summary = build_execution_summary(BuildSummaryArgs {
        phase_name,
        duration_str: &duration_str,
        success,
        no_changes_detected,
        exit_code,
        output: &output,
        stderr_output: &stderr_output,
    });
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        if let Ok(c) = comments::add_system_comment(&conn, &card.card.id, &execution.id, &summary) {
            callbacks.on_comment_added(&c);
        }
    }

    // Final callback
    let short_error = if !success && !stderr_output.is_empty() {
        stderr_output.lines().last().map(|l| l.chars().take(100).collect::<String>())
    } else {
        None
    };
    let status_str = if success { "success" } else { "failed" };
    callbacks.on_execution_completed(
        &execution.id,
        status_str,
        exit_code,
        short_error.as_deref(),
    );

    // Complete execution record
    {
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        executions::finish(&conn, &execution.id, status, Some(exit_code as i64), cost_usd)?;
    }

    let rate_limit_info = if !success {
        let info = crate::executor::detect_rate_limit(&output, &stderr_output, exit_code);
        if info.is_rate_limit { Some(info) } else { None }
    } else {
        None
    };

    Ok(RunResult {
        success,
        exit_code,
        output,
        rate_limit_info,
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn should_fail_no_changes(
    phase: &ExecutionPhase,
    exit_code: i32,
    files_changed: &[FileChangeInfo],
    sha_before: Option<&str>,
    sha_after: Option<&str>,
) -> bool {
    if !matches!(phase, ExecutionPhase::Execute) { return false; }
    if exit_code != 0 { return false; }
    let Some(before) = sha_before else { return false; };
    if !files_changed.is_empty() { return false; }
    sha_after.map(|after| after == before).unwrap_or(false)
}

fn serialize_file_changes(files: &[FileChangeInfo]) -> String {
    if files.is_empty() { return String::new(); }
    let entries: Vec<String> = files
        .iter()
        .map(|f| format!("{{\"path\":{:?},\"additions\":{},\"deletions\":{}}}", f.path, f.additions, f.deletions))
        .collect();
    format!("[{}]", entries.join(","))
}

fn format_duration(ms: u64) -> String {
    let seconds = ms / 1000;
    if seconds < 60 {
        return format!("{}s", seconds);
    }
    let minutes = seconds / 60;
    let remaining_seconds = seconds % 60;
    format!("{}m {}s", minutes, remaining_seconds)
}

struct BuildSummaryArgs<'a> {
    phase_name: &'a str,
    duration_str: &'a str,
    success: bool,
    no_changes_detected: bool,
    exit_code: i32,
    output: &'a str,
    stderr_output: &'a str,
}

fn build_execution_summary(args: BuildSummaryArgs<'_>) -> String {
    let BuildSummaryArgs {
        phase_name,
        duration_str,
        success,
        no_changes_detected,
        exit_code,
        output,
        stderr_output,
    } = args;

    if no_changes_detected {
        return format!(
            "{} produced no file changes in {} — marked as failed. The AI exited successfully but did not modify any files.",
            phase_name, duration_str
        );
    }
    if success {
        return format!("{} completed successfully in {}.", phase_name, duration_str);
    }

    let tail = |text: &str, max_len: usize| -> String {
        let trimmed = text.trim();
        if trimmed.is_empty() { return String::new(); }
        if trimmed.len() > max_len {
            format!("...{}", &trimmed[trimmed.len() - max_len..])
        } else {
            trimmed.to_string()
        }
    };

    let mut summary = format!(
        "{} failed with exit code {} after {}.",
        phase_name, exit_code, duration_str
    );
    if !stderr_output.is_empty() {
        summary.push_str(&format!("\n\nstderr:\n{}", tail(stderr_output, 500)));
    }
    if !output.is_empty() {
        summary.push_str(&format!("\n\nLast output:\n{}", tail(output, 500)));
    }

    // Check for git error and append guidance
    let git_err = crate::executor::detect_git_error(output, stderr_output, exit_code);
    if let Some(ge) = git_err {
        summary.push_str(&format!(
            "\n\n**Git Error: {}**\n**How to fix:** {}",
            ge.message, ge.suggestion
        ));
    }

    summary
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{boards, cards, connection::open_memory};
    use crate::types::{Assignee, CardWithTags, Comment, CreateBoard, CreateCard, ExecutionPhase};
    use std::sync::Mutex as StdMutex;

    // Stub callbacks that record events for assertion
    struct RecordingCallbacks {
        events: StdMutex<Vec<String>>,
    }

    impl RecordingCallbacks {
        fn new() -> Arc<Self> {
            Arc::new(Self { events: StdMutex::new(vec![]) })
        }

        fn events(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }
    }

    impl RunnerCallbacks for RecordingCallbacks {
        fn on_execution_started(&self, _card_id: &str, execution_id: &str, phase: ExecutionPhase) {
            let phase_str = match phase { ExecutionPhase::Plan => "plan", ExecutionPhase::Execute => "execute" };
            self.events.lock().unwrap().push(format!("started:{}:{}", execution_id, phase_str));
        }
        fn on_output(&self, _execution_id: &str, chunk: &str) {
            self.events.lock().unwrap().push(format!("output:{}", chunk.len()));
        }
        fn on_execution_completed(&self, execution_id: &str, status: &str, _exit_code: i32, _error_summary: Option<&str>) {
            self.events.lock().unwrap().push(format!("completed:{}:{}", execution_id, status));
        }
        fn on_card_updated(&self, card: &CardWithTags) {
            self.events.lock().unwrap().push(format!("card_updated:{}", card.card.id));
        }
        fn on_comment_added(&self, _comment: &Comment) {
            self.events.lock().unwrap().push("comment_added".to_string());
        }
    }

    fn make_config(cli_custom_command: &str) -> RunnerConfig {
        RunnerConfig {
            cli_provider: "custom".to_string(),
            model: String::new(),
            max_budget_usd: 0.0,
            cli_custom_command: cli_custom_command.to_string(),
            plan_thinking: String::new(), // no plan phase
            execute_thinking: String::new(),
            custom_instructions: String::new(),
            auto_commit: false,
            auto_push: false,
            branch_mode: "current".to_string(),
            branch_name: None,
        }
    }

    fn make_board(dir: &str) -> Board {
        Board {
            id: "b1".into(),
            name: "Test Board".into(),
            description: String::new(),
            directory: dir.to_string(),
            session_id: None,
            color: None,
            scratchpad: String::new(),
            slug: None,
            github_url: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// Test 1: runs_card_to_completion_with_stub_cli
    ///
    /// Uses a custom CLI that echoes a single JSON result event.
    /// The stub produces a result event which doesn't make file changes, but since
    /// we initialise git with an empty repo, sha_before capture will succeed and
    /// sha_after == sha_before → no-changes would fire. To avoid that, we set the
    /// cli to produce output that the stream parser reads as text (not just a result).
    /// Alternatively we can make the stub write a file. Easiest: make sha_before None
    /// by NOT git-initing — but then we can't get sha_before at all which is fine,
    /// `should_fail_no_changes` returns false when sha_before is None.
    ///
    /// Strategy: use a tempdir without git init. sha_before will be None, so
    /// no-changes detection is skipped and the exit-0 is treated as success.
    #[tokio::test]
    async fn runs_card_to_completion_with_stub_cli() {
        let tmp = tempfile::tempdir().unwrap();

        // Set up in-memory DB
        let conn = open_memory().unwrap();
        let board_record = boards::create(
            &conn,
            &CreateBoard {
                name: "b".into(),
                description: String::new(),
                directory: tmp.path().to_str().unwrap().to_string(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        let card_with_tags = cards::create(
            &conn,
            &board_record.id,
            &CreateCard {
                title: "Test card".into(),
                description: None,
                tags: None,
                assignee: None,
            },
        )
        .unwrap();

        let db = Arc::new(Mutex::new(conn));
        let board = make_board(tmp.path().to_str().unwrap());
        let callbacks = RecordingCallbacks::new();

        // Write a stub script that prints a JSON result event and exits 0.
        // The `custom` CLI provider splits the command on whitespace and appends the
        // prompt as the last argument, so we need the script to be a single token
        // (a file path with no spaces) that accepts arbitrary extra args and ignores them.
        let script_path = tmp.path().join("stub_cli.sh");
        std::fs::write(
            &script_path,
            "#!/bin/sh\necho '{\"type\":\"result\",\"result\":\"done\",\"cost_usd\":0.0,\"session_id\":\"s\"}'\n",
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let stub_cmd = script_path.to_str().unwrap().to_string();

        let config = RunnerConfig {
            cli_provider: "custom".to_string(),
            model: String::new(),
            max_budget_usd: 0.0,
            cli_custom_command: stub_cmd,
            plan_thinking: String::new(),
            execute_thinking: String::new(),
            custom_instructions: String::new(),
            auto_commit: false,
            auto_push: false,
            branch_mode: "current".to_string(),
            branch_name: None,
        };

        let result = run_card(
            db.clone(),
            card_with_tags.clone(),
            board.clone(),
            vec![],
            config,
            callbacks.clone(),
            RunOptions::default(),
            vec![],
        )
        .await
        .unwrap();

        assert!(result.success, "run_card should succeed with stub CLI");
        assert_eq!(result.exit_code, 0);

        // Check callbacks fired
        let events = callbacks.events();
        assert!(
            events.iter().any(|e| e.starts_with("started:")),
            "on_execution_started must fire; events={:?}",
            events
        );
        assert!(
            events.iter().any(|e| e.starts_with("completed:")),
            "on_execution_completed must fire; events={:?}",
            events
        );

        // Check execution record in DB
        let db_conn = db.lock().unwrap();
        let execs = executions::list_for_card(&db_conn, &card_with_tags.card.id).unwrap();
        assert!(!execs.is_empty(), "at least one execution should be recorded");
        // The execution should have been finished (not still running)
        // We call finish() which sets finished_at. The status was set to success.
        // Note: due to timing, status might be "success" from update_status + finish.
        let last_exec = execs.last().unwrap();
        assert!(
            matches!(last_exec.status, ExecutionStatus::Success | ExecutionStatus::Failed),
            "execution status should be terminal; was {:?}",
            last_exec.status
        );
    }

    /// Test 2: human_assignee_returns_success_without_spawning
    #[tokio::test]
    async fn human_assignee_returns_success_without_spawning() {
        let tmp = tempfile::tempdir().unwrap();

        let conn = open_memory().unwrap();
        let board_record = boards::create(
            &conn,
            &CreateBoard {
                name: "b2".into(),
                description: String::new(),
                directory: tmp.path().to_str().unwrap().to_string(),
                color: None,
                slug: None,
                github_url: None,
            },
        )
        .unwrap();
        let card_with_tags = cards::create(
            &conn,
            &board_record.id,
            &CreateCard {
                title: "Human task".into(),
                description: None,
                tags: None,
                assignee: Some(Assignee::Human),
            },
        )
        .unwrap();

        let db = Arc::new(Mutex::new(conn));
        let board = make_board(tmp.path().to_str().unwrap());
        let callbacks = RecordingCallbacks::new();

        let result = run_card(
            db.clone(),
            card_with_tags.clone(),
            board,
            vec![],
            make_config("should-not-run"),
            callbacks.clone(),
            RunOptions::default(),
            vec![],
        )
        .await
        .unwrap();

        assert!(result.success, "human-assignee card should return success");
        assert_eq!(result.exit_code, 0);

        // No execution started callback should fire
        let events = callbacks.events();
        assert!(
            !events.iter().any(|e| e.starts_with("started:")),
            "on_execution_started must NOT fire for human assignee; events={:?}",
            events
        );

        // No execution record should have been created
        let db_conn = db.lock().unwrap();
        let execs = executions::list_for_card(&db_conn, &card_with_tags.card.id).unwrap();
        assert!(execs.is_empty(), "no executions should be created for human-assignee card");
    }
}
