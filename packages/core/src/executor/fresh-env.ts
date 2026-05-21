import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TOKEN_FILE = join(homedir(), ".glue-paste-dev", "oauth-token");

/**
 * Resolves the user's full login-shell PATH.
 * On macOS, GUI apps inherit a stripped system PATH that excludes Homebrew
 * (/opt/homebrew/bin) and other user-installed tool directories. Running
 * `zsh -l -c 'echo $PATH'` loads the user's shell profile and returns the
 * real PATH, which is required to find binaries like `claude`.
 */
function resolveShellPath(): string {
  for (const shell of ["zsh", "bash"]) {
    try {
      const r = spawnSync(shell, ["-l", "-c", "echo $PATH"], {
        timeout: 3000,
        encoding: "utf-8",
        env: { HOME: homedir(), PATH: process.env.PATH ?? "" },
      });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    } catch {
      // try next shell
    }
  }
  return process.env.PATH ?? "";
}

const SHELL_PATH = resolveShellPath();

/**
 * Rejects obviously invalid tokens (test stubs, short strings).
 * Real OAuth tokens are typically 100+ characters.
 */
function looksLikeOAuthToken(token: string): boolean {
  return token.length >= 40 && !/^test[-_]/.test(token);
}

let cachedEnv: Record<string, string | undefined> | null = null;
let cachedAt = 0;
const ENV_CACHE_TTL = 5000; // 5 seconds

/**
 * Returns an env for spawning CLI subprocesses with the freshest
 * available OAuth token. Results are cached for 5s to avoid
 * redundant process.env copies.
 *
 * Token sources, checked in order:
 * 1. Token file (~/.glue-paste-dev/oauth-token) — written by the
 *    server's /api/auth/token endpoint whenever a client supplies one.
 * 2. macOS Keychain (Claude Code-credentials) — if not expired.
 * 3. process.env fallback (daemon's snapshot, may be stale).
 */
export function getFreshEnv(): Record<string, string | undefined> {
  if (cachedEnv && Date.now() - cachedAt < ENV_CACHE_TTL) return cachedEnv;

  let result: Record<string, string | undefined> | null = null;

  const base = { ...process.env, PATH: SHELL_PATH };

  // 1. Token file (most likely to be fresh — updated by API)
  try {
    if (existsSync(TOKEN_FILE)) {
      const token = readFileSync(TOKEN_FILE, "utf-8").trim();
      if (token && looksLikeOAuthToken(token)) {
        result = { ...base, CLAUDE_CODE_OAUTH_TOKEN: token };
      }
    }
  } catch {
    // fall through
  }

  // 2. macOS Keychain
  if (!result && process.platform === "darwin") {
    try {
      const kcResult = spawnSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { timeout: 3000, encoding: "utf-8" },
      );
      if (kcResult.status === 0 && kcResult.stdout) {
        const creds = JSON.parse(kcResult.stdout.trim());
        const oauth = creds?.claudeAiOauth;
        if (oauth?.accessToken && Date.now() < (oauth.expiresAt ?? 0) - 60_000) {
          result = { ...base, CLAUDE_CODE_OAUTH_TOKEN: oauth.accessToken };
        }
      }
    } catch {
      // fall through
    }
  }

  // 3. base env with shell PATH
  if (!result) {
    result = base;
  }

  cachedEnv = result;
  cachedAt = Date.now();
  return result;
}
