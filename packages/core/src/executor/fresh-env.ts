import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TOKEN_FILE = join(homedir(), ".glue-paste-dev", "oauth-token");

/**
 * Returns an env for spawning CLI subprocesses with the freshest
 * available OAuth token.
 *
 * Token sources, checked in order:
 * 1. Token file (~/.glue-paste-dev/oauth-token) — written by the
 *    server's /api/auth/token endpoint whenever a client supplies one.
 * 2. macOS Keychain (Claude Code-credentials) — if not expired.
 * 3. process.env fallback (daemon's snapshot, may be stale).
 */
export function getFreshEnv(): Record<string, string | undefined> {
  // 1. Token file (most likely to be fresh — updated by API)
  try {
    if (existsSync(TOKEN_FILE)) {
      const token = readFileSync(TOKEN_FILE, "utf-8").trim();
      if (token) {
        return { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
      }
    }
  } catch {
    // fall through
  }

  // 2. macOS Keychain
  if (process.platform === "darwin") {
    try {
      const result = spawnSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { timeout: 3000, encoding: "utf-8" },
      );
      if (result.status === 0 && result.stdout) {
        const creds = JSON.parse(result.stdout.trim());
        const oauth = creds?.claudeAiOauth;
        if (oauth?.accessToken && Date.now() < (oauth.expiresAt ?? 0) - 60_000) {
          return { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauth.accessToken };
        }
      }
    } catch {
      // fall through
    }
  }

  // 3. process.env as-is
  return { ...process.env };
}
