/**
 * Detects git-related errors from CLI output and produces
 * user-friendly messages with actionable suggestions.
 */

export interface GitErrorInfo {
  type: string;
  message: string;
  suggestion: string;
}

interface GitErrorPattern {
  type: string;
  patterns: RegExp[];
  message: string;
  suggestion: string;
}

const GIT_ERROR_PATTERNS: GitErrorPattern[] = [
  {
    type: "auth",
    patterns: [
      /fatal: Authentication failed/i,
      /could not read Username/i,
      /Invalid username or password/i,
    ],
    message: "Git authentication failed.",
    suggestion:
      "Check your Git credentials. If using HTTPS, ensure your personal access token is valid and not expired. Run: git config --global credential.helper to check your credential helper. You may need to refresh your token at https://github.com/settings/tokens.",
  },
  {
    type: "ssh-key",
    patterns: [
      /Permission denied \(publickey\)/i,
      /Host key verification failed/i,
      /Could not resolve hostname/i,
    ],
    message: "SSH authentication failed.",
    suggestion:
      "Your SSH key may be missing or not added to your GitHub account. Run: ssh -T git@github.com to test. If it fails, check https://docs.github.com/en/authentication/connecting-to-github-with-ssh.",
  },
  {
    type: "permission",
    patterns: [
      /Permission to .+ denied/i,
      /You don't have permission/i,
      /403.*Forbidden/i,
    ],
    message: "Permission denied for this repository.",
    suggestion:
      "Your Git user does not have write permission to this repository. Check repository access settings on GitHub, or verify you're authenticated as the correct user with: git config user.name",
  },
  {
    type: "protected-branch",
    patterns: [
      /protected branch/i,
      /GH006/i,
      /required status check/i,
    ],
    message: "Push rejected: branch is protected.",
    suggestion:
      "This branch has protection rules. Push to a feature branch instead and create a pull request. Or update branch protection settings in the repository's Settings > Branches.",
  },
  {
    type: "push-rejected",
    patterns: [
      /\[rejected\].*non-fast-forward/i,
      /failed to push some refs/i,
      /Updates were rejected because/i,
    ],
    message: "Push rejected: remote has changes you don't have locally.",
    suggestion:
      "Run 'git pull --rebase' to incorporate remote changes before pushing, or 'git pull' to merge.",
  },
  {
    type: "remote-not-found",
    patterns: [
      /repository .+ not found/i,
      /fatal: Remote .+ not found/i,
      /Could not read from remote repository/i,
    ],
    message: "Remote repository not found.",
    suggestion:
      "Check the remote URL with 'git remote -v'. Ensure the repository exists and you have access. The URL may have changed or the repo may have been deleted.",
  },
  {
    type: "merge-conflict",
    patterns: [
      /CONFLICT \(/i,
      /Automatic merge failed/i,
      /fix conflicts and then commit/i,
    ],
    message: "Merge conflict detected.",
    suggestion:
      "There are conflicting changes that need manual resolution. Open the conflicting files, resolve the markers (<<<<<<< / ======= / >>>>>>>), stage the resolved files, and commit.",
  },
  {
    type: "detached-head",
    patterns: [
      /not currently on a branch/i,
      /HEAD detached/i,
    ],
    message: "Not on a branch (detached HEAD state).",
    suggestion:
      "You're not on a branch. Create or switch to one with: git checkout -b <branch-name>, or git checkout <existing-branch>.",
  },
  {
    type: "generic-git",
    patterns: [/^fatal:/m],
    message: "A git error occurred.",
    suggestion:
      "Check the error message above for details. Common fixes: ensure you're in a git repository, the remote is reachable, and your credentials are valid.",
  },
];

export function detectGitError(
  stdout: string,
  stderr: string,
  exitCode: number
): GitErrorInfo | null {
  if (exitCode === 0) return null;

  const combined = `${stderr}\n${stdout}`;

  for (const { type, patterns, message, suggestion } of GIT_ERROR_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) {
      return { type, message, suggestion };
    }
  }

  return null;
}
