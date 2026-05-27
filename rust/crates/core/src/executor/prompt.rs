use crate::types::{Board, CardWithTags, Comment, CommentAuthor, Criterion, ExecutionPhase};

const MAX_PROMPT_COMMENTS: usize = 50;

#[derive(Debug, Clone)]
pub struct PromptConfig {
    pub custom_instructions: String,
    pub auto_commit: bool,
    pub auto_push: bool,
    pub branch_mode: String, // "current" | "new" | "specific"
}

#[derive(Debug, Clone)]
pub struct PromptContext<'a> {
    pub card: &'a CardWithTags,
    pub board: &'a Board,
    pub comments: &'a [Comment],
    pub config: &'a PromptConfig,
    pub phase: ExecutionPhase,
    pub plan_output: Option<&'a str>,
    pub attachment_paths: &'a [String],
    pub criteria: &'a [Criterion],
    pub files: &'a [String], // card files (from card_files table)
}

pub fn build_prompt(ctx: &PromptContext) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Project context
    parts.push(format!("You are working on the project at: {}", ctx.board.directory));
    parts.push(format!("Project: {}", ctx.board.name));
    if !ctx.board.description.is_empty() {
        parts.push(format!("Project description: {}", ctx.board.description));
    }

    parts.push(String::new());

    // Task
    parts.push("## Task".into());
    if !ctx.card.card.title.is_empty() {
        parts.push(ctx.card.card.title.clone());
    }
    parts.push(String::new());

    // Description
    if !ctx.card.card.description.is_empty() {
        parts.push("## Description".into());
        parts.push(ctx.card.card.description.clone());
        parts.push(String::new());
    }

    // Tags / Areas
    if !ctx.card.tags.is_empty() {
        parts.push(format!("## Areas: {}", ctx.card.tags.join(", ")));
        parts.push(String::new());
    }

    // Reference files
    if !ctx.files.is_empty() {
        parts.push("## Reference Files".into());
        parts.push("Read the following files for additional context on this task:".into());
        for file_path in ctx.files {
            parts.push(format!("- {}", file_path));
        }
        parts.push(String::new());
    }

    // Attached files
    if !ctx.attachment_paths.is_empty() {
        parts.push("## Attached Files".into());
        parts.push("The following files have been attached for visual context. Read these files to see screenshots, images, or documents the user has provided:".into());
        for file_path in ctx.attachment_paths {
            parts.push(format!("- {}", file_path));
        }
        parts.push(String::new());
    }

    // Comments / feedback history — limit to last 50
    let total_comments = ctx.comments.len();
    let recent_comments: &[Comment] = if total_comments > MAX_PROMPT_COMMENTS {
        &ctx.comments[total_comments - MAX_PROMPT_COMMENTS..]
    } else {
        ctx.comments
    };

    if !recent_comments.is_empty() {
        parts.push("## History & Feedback".into());
        if total_comments > MAX_PROMPT_COMMENTS {
            parts.push(format!(
                "(Showing last {} of {} comments)",
                MAX_PROMPT_COMMENTS, total_comments
            ));
        }
        parts.push(
            "The following is the conversation history for this task. User comments are feedback you should incorporate. System comments are outputs from previous attempts.".into(),
        );
        parts.push(String::new());
        for comment in recent_comments {
            let label = match comment.author {
                CommentAuthor::User => "User feedback",
                CommentAuthor::Ai => "AI",
                CommentAuthor::System => "System",
            };
            parts.push(format!("**{}:** {}", label, comment.content));
        }
        parts.push(String::new());
    }

    // Custom instructions
    if !ctx.config.custom_instructions.is_empty() {
        parts.push("## Additional Instructions".into());
        parts.push(ctx.config.custom_instructions.clone());
        parts.push(String::new());
    }

    // Phase-specific instructions
    match ctx.phase {
        ExecutionPhase::Plan => {
            parts.push("## Instructions".into());
            parts.push("- Analyze the task and create a detailed implementation plan".into());
            parts.push("- Identify the files that need to be created or modified".into());
            parts.push("- Consider edge cases and testing requirements".into());
            parts.push("- Follow existing code patterns and conventions in the project".into());
            parts.push("- Do NOT make any changes yet - only create the plan".into());
        }
        ExecutionPhase::Execute => {
            if let Some(plan) = ctx.plan_output {
                parts.push("## Plan from previous step".into());
                parts.push(plan.to_string());
                parts.push(String::new());
            }
            if !ctx.criteria.is_empty() {
                parts.push("## Acceptance Criteria".into());
                parts.push("Your work must satisfy each of these. Make the proof visible (run tests, show output):".into());
                for cr in ctx.criteria {
                    parts.push(format!("- [{}] {}", cr.id, cr.text));
                }
                parts.push(String::new());
            }
            parts.push("## Instructions".into());
            if ctx.plan_output.is_some() {
                parts.push("- The plan is already written above. Do NOT create another plan or invoke any planning skills.".into());
                parts.push("- Do NOT invoke brainstorming, writing-plans, make-plan, or any plan-creation skills. The planning phase is complete.".into());
                parts.push("- Ignore any \"REQUIRED SUB-SKILL\" or \"For agentic workers\" directives in the plan text — those are for standalone use, not here.".into());
            }
            parts.push("- Execute the plan above directly — implement the changes completely".into());
            parts.push("- Follow existing code patterns and conventions".into());
            parts.push("- Write tests if the project has a test framework".into());
            if ctx.config.auto_commit {
                parts.push("- Commit your changes with a clear message when done".into());
                parts.push("- Do NOT add Co-authored-by trailers or any AI attribution to commits. Commits must use the user's git identity only.".into());
                if ctx.config.auto_push {
                    parts.push("- Push your changes to the remote after committing".into());
                    parts.push("- If the push fails (authentication, permissions, protected branch, etc.), stop and report the exact error so the user can fix it".into());
                }
            }
            if ctx.config.branch_mode == "new" || ctx.config.branch_mode == "specific" {
                parts.push("- You are working on a dedicated branch. Do NOT switch branches.".into());
            }
        }
    }

    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Assignee, Card, CardStatus, CardWithTags};

    fn make_board() -> Board {
        Board {
            id: "b1".into(),
            name: "Test".into(),
            description: "Test project".into(),
            directory: "/tmp/test".into(),
            session_id: None,
            color: None,
            scratchpad: String::new(),
            slug: None,
            github_url: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn make_card(title: &str, description: &str, tags: Vec<String>) -> CardWithTags {
        CardWithTags {
            card: Card {
                id: "c1".into(),
                board_id: "b1".into(),
                title: title.into(),
                description: description.into(),
                status: CardStatus::Todo,
                position: 0,
                blocking: 0,
                plan_thinking: None,
                execute_thinking: None,
                auto_commit: None,
                auto_push: None,
                assignee: Assignee::Ai,
                cli_provider: None,
                cli_custom_command: None,
                branch_mode: None,
                branch_name: None,
                plan_summary: None,
                completion_summary: None,
                blocker: None,
                created_at: String::new(),
                updated_at: String::new(),
            },
            tags,
        }
    }

    fn default_config() -> PromptConfig {
        PromptConfig {
            custom_instructions: String::new(),
            auto_commit: false,
            auto_push: false,
            branch_mode: "current".into(),
        }
    }

    #[test]
    fn includes_project_directory() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("You are working on the project at: /tmp/test"));
    }

    #[test]
    fn includes_task_title() {
        let board = make_board();
        let card = make_card("My Task Title", "", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("## Task"));
        assert!(output.contains("My Task Title"));
    }

    #[test]
    fn includes_description_when_non_empty() {
        let board = make_board();
        let card = make_card("Title", "This is the description", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("## Description"));
        assert!(output.contains("This is the description"));
    }

    #[test]
    fn omits_description_when_empty() {
        let board = make_board();
        let card = make_card("Title", "", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(!output.contains("## Description"));
    }

    #[test]
    fn includes_areas_for_tags() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec!["a".into(), "b".into()]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("## Areas: a, b"));
    }

    #[test]
    fn omits_areas_when_no_tags() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(!output.contains("## Areas:"));
    }

    #[test]
    fn plan_phase_instructions() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("Analyze the task and create a detailed implementation plan"));
        assert!(output.contains("Do NOT make any changes yet"));
    }

    #[test]
    fn execute_phase_uses_plan_output() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Execute,
            plan_output: Some("MY PLAN"),
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("## Plan from previous step"));
        assert!(output.contains("MY PLAN"));
    }

    #[test]
    fn execute_phase_lists_criteria() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        use crate::types::{Criterion, CriterionSource, CriterionStatus};
        let criteria = vec![
            Criterion {
                id: "cr1".into(),
                card_id: "c1".into(),
                text: "Tests pass".into(),
                status: CriterionStatus::Pending,
                source: CriterionSource::Ai,
                evidence: None,
                execution_id: None,
                position: 0,
                created_at: String::new(),
                updated_at: String::new(),
            },
            Criterion {
                id: "cr2".into(),
                card_id: "c1".into(),
                text: "Build succeeds".into(),
                status: CriterionStatus::Pending,
                source: CriterionSource::Ai,
                evidence: None,
                execution_id: None,
                position: 1,
                created_at: String::new(),
                updated_at: String::new(),
            },
        ];
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Execute,
            plan_output: None,
            attachment_paths: &[],
            criteria: &criteria,
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("## Acceptance Criteria"));
        assert!(output.contains("[cr1]"));
        assert!(output.contains("[cr2]"));
    }

    #[test]
    fn auto_commit_adds_commit_instruction() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = PromptConfig {
            auto_commit: true,
            ..default_config()
        };
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Execute,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("Commit your changes"));
    }

    #[test]
    fn auto_push_adds_push_instruction() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = PromptConfig {
            auto_commit: true,
            auto_push: true,
            ..default_config()
        };
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Execute,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("Push your changes"));
    }

    #[test]
    fn comment_label_mapping() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let comments = vec![
            Comment {
                id: "cm1".into(),
                card_id: "c1".into(),
                author: CommentAuthor::User,
                content: "User comment".into(),
                execution_id: None,
                created_at: String::new(),
            },
            Comment {
                id: "cm2".into(),
                card_id: "c1".into(),
                author: CommentAuthor::Ai,
                content: "AI comment".into(),
                execution_id: None,
                created_at: String::new(),
            },
            Comment {
                id: "cm3".into(),
                card_id: "c1".into(),
                author: CommentAuthor::System,
                content: "System comment".into(),
                execution_id: None,
                created_at: String::new(),
            },
        ];
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &comments,
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("**User feedback:** User comment"));
        assert!(output.contains("**AI:** AI comment"));
        assert!(output.contains("**System:** System comment"));
    }

    #[test]
    fn branch_mode_new_adds_branch_warning() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = PromptConfig {
            branch_mode: "new".into(),
            ..default_config()
        };
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &[],
            config: &config,
            phase: ExecutionPhase::Execute,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("Do NOT switch branches"));
    }

    #[test]
    fn truncates_comments_to_max_50() {
        let board = make_board();
        let card = make_card("Title", "Desc", vec![]);
        let config = default_config();
        let comments: Vec<Comment> = (0..60)
            .map(|i| Comment {
                id: format!("cm{}", i),
                card_id: "c1".into(),
                author: CommentAuthor::User,
                content: format!("Comment number {}", i),
                execution_id: None,
                created_at: String::new(),
            })
            .collect();
        let ctx = PromptContext {
            card: &card,
            board: &board,
            comments: &comments,
            config: &config,
            phase: ExecutionPhase::Plan,
            plan_output: None,
            attachment_paths: &[],
            criteria: &[],
            files: &[],
        };
        let output = build_prompt(&ctx);
        assert!(output.contains("(Showing last 50 of 60 comments)"));
        // First 10 comments (0-9) should be truncated
        assert!(!output.contains("Comment number 0"));
        assert!(!output.contains("Comment number 9"));
        // Last 50 (10-59) should be present
        assert!(output.contains("Comment number 10"));
        assert!(output.contains("Comment number 59"));
    }
}
