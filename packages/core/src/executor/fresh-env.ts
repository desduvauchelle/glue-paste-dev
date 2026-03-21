import { spawnSync } from "node:child_process";

/**
 * Reads the fresh Claude OAuth token from macOS Keychain and returns
 * an env object suitable for spawning CLI subprocesses.
 * Falls back to process.env if the keychain read fails.
 */
export async function getFreshEnv(): Promise<Record<string, string | undefined>> {
  try {
    if (process.platform !== "darwin") return { ...process.env };

    const result = spawnSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 3000, encoding: "utf-8" },
    );

    if (result.status !== 0 || !result.stdout) return { ...process.env };

    const creds = JSON.parse(result.stdout.trim());
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) return { ...process.env };

    return { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token };
  } catch {
    return { ...process.env };
  }
}
