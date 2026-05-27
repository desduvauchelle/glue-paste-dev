use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub struct GitErrorInfo {
    pub kind: String,
    pub message: String,
    pub suggestion: String,
}

struct GitErrorPattern {
    kind: &'static str,
    patterns: &'static [&'static str],
    message: &'static str,
    suggestion: &'static str,
}

static GIT_ERROR_PATTERN_DEFS: &[GitErrorPattern] = &[
    GitErrorPattern {
        kind: "auth",
        patterns: &[
            r"(?i)fatal: Authentication failed",
            r"(?i)could not read Username",
            r"(?i)Invalid username or password",
        ],
        message: "Git authentication failed.",
        suggestion: "Check your Git credentials. If using HTTPS, ensure your personal access token is valid and not expired. Run: git config --global credential.helper to check your credential helper. You may need to refresh your token at https://github.com/settings/tokens.",
    },
    GitErrorPattern {
        kind: "ssh-key",
        patterns: &[
            r"(?i)Permission denied \(publickey\)",
            r"(?i)Host key verification failed",
            r"(?i)Could not resolve hostname",
        ],
        message: "SSH authentication failed.",
        suggestion: "Your SSH key may be missing or not added to your GitHub account. Run: ssh -T git@github.com to test. If it fails, check https://docs.github.com/en/authentication/connecting-to-github-with-ssh.",
    },
    GitErrorPattern {
        kind: "permission",
        patterns: &[
            r"(?i)Permission to .+ denied",
            r"(?i)You don't have permission",
            r"(?i)403.*Forbidden",
        ],
        message: "Permission denied for this repository.",
        suggestion: "Your Git user does not have write permission to this repository. Check repository access settings on GitHub, or verify you're authenticated as the correct user with: git config user.name",
    },
    GitErrorPattern {
        kind: "protected-branch",
        patterns: &[
            r"(?i)protected branch",
            r"(?i)GH006",
            r"(?i)required status check",
        ],
        message: "Push rejected: branch is protected.",
        suggestion: "This branch has protection rules. Push to a feature branch instead and create a pull request. Or update branch protection settings in the repository's Settings > Branches.",
    },
    GitErrorPattern {
        kind: "push-rejected",
        patterns: &[
            r"(?i)\[rejected\].*non-fast-forward",
            r"(?i)failed to push some refs",
            r"(?i)Updates were rejected because",
        ],
        message: "Push rejected: remote has changes you don't have locally.",
        suggestion: "Run 'git pull --rebase' to incorporate remote changes before pushing, or 'git pull' to merge.",
    },
    GitErrorPattern {
        kind: "remote-not-found",
        patterns: &[
            r"(?i)repository .+ not found",
            r"(?i)fatal: Remote .+ not found",
            r"(?i)Could not read from remote repository",
        ],
        message: "Remote repository not found.",
        suggestion: "Check the remote URL with 'git remote -v'. Ensure the repository exists and you have access. The URL may have changed or the repo may have been deleted.",
    },
    GitErrorPattern {
        kind: "merge-conflict",
        patterns: &[
            r"(?i)CONFLICT \(",
            r"(?i)Automatic merge failed",
            r"(?i)fix conflicts and then commit",
        ],
        message: "Merge conflict detected.",
        suggestion: "There are conflicting changes that need manual resolution. Open the conflicting files, resolve the markers (<<<<<<< / ======= / >>>>>>>), stage the resolved files, and commit.",
    },
    GitErrorPattern {
        kind: "detached-head",
        patterns: &[
            r"(?i)not currently on a branch",
            r"(?i)HEAD detached",
        ],
        message: "Not on a branch (detached HEAD state).",
        suggestion: "You're not on a branch. Create or switch to one with: git checkout -b <branch-name>, or git checkout <existing-branch>.",
    },
    GitErrorPattern {
        kind: "generic-git",
        patterns: &[r"(?m)^fatal:"],
        message: "A git error occurred.",
        suggestion: "Check the error message above for details. Common fixes: ensure you're in a git repository, the remote is reachable, and your credentials are valid.",
    },
];

struct CompiledGitErrorPattern {
    kind: &'static str,
    regexes: Vec<Regex>,
    message: &'static str,
    suggestion: &'static str,
}

static COMPILED_PATTERNS: OnceLock<Vec<CompiledGitErrorPattern>> = OnceLock::new();

fn compiled_patterns() -> &'static Vec<CompiledGitErrorPattern> {
    COMPILED_PATTERNS.get_or_init(|| {
        GIT_ERROR_PATTERN_DEFS
            .iter()
            .map(|def| CompiledGitErrorPattern {
                kind: def.kind,
                regexes: def
                    .patterns
                    .iter()
                    .map(|p| Regex::new(p).expect("valid regex"))
                    .collect(),
                message: def.message,
                suggestion: def.suggestion,
            })
            .collect()
    })
}

pub fn detect_git_error(stdout: &str, stderr: &str, exit_code: i32) -> Option<GitErrorInfo> {
    if exit_code == 0 {
        return None;
    }

    let combined = format!("{}\n{}", stderr, stdout);

    for pat in compiled_patterns() {
        if pat.regexes.iter().any(|r| r.is_match(&combined)) {
            return Some(GitErrorInfo {
                kind: pat.kind.to_string(),
                message: pat.message.to_string(),
                suggestion: pat.suggestion.to_string(),
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_match_on_success() {
        let result = detect_git_error("", "fatal: anything", 0);
        assert_eq!(result, None);
    }

    #[test]
    fn detects_auth() {
        let result = detect_git_error("", "fatal: Authentication failed", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "auth");
    }

    #[test]
    fn detects_ssh_key() {
        let result = detect_git_error("", "Permission denied (publickey).", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "ssh-key");
    }

    #[test]
    fn detects_permission() {
        let result = detect_git_error("", "Permission to repo denied to user.", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "permission");
    }

    #[test]
    fn detects_protected_branch() {
        let result = detect_git_error("", "remote: error: GH006: protected branch", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "protected-branch");
    }

    #[test]
    fn detects_push_rejected() {
        let result = detect_git_error(
            "",
            "! [rejected]  main -> main (non-fast-forward)",
            1,
        );
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "push-rejected");
    }

    #[test]
    fn detects_remote_not_found() {
        let result = detect_git_error("", "repository 'x' not found", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "remote-not-found");
    }

    #[test]
    fn detects_merge_conflict() {
        let result = detect_git_error("", "CONFLICT (content): blah", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "merge-conflict");
    }

    #[test]
    fn detects_detached_head() {
        let result = detect_git_error("", "HEAD detached at abc123", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "detached-head");
    }

    #[test]
    fn falls_back_to_generic_git() {
        let result = detect_git_error("", "fatal: something weird", 1);
        assert!(result.is_some());
        assert_eq!(result.unwrap().kind, "generic-git");
    }

    #[test]
    fn returns_none_for_unrelated() {
        let result = detect_git_error("", "ENOENT no such file", 1);
        assert_eq!(result, None);
    }
}
