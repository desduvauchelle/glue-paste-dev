/**
 * Returns an env object for spawning CLI subprocesses, with stale
 * OAuth tokens removed so the CLI can authenticate itself via Keychain.
 *
 * When the daemon starts it snapshots process.env, including
 * CLAUDE_CODE_OAUTH_TOKEN. That token eventually expires, but because
 * the env var overrides the CLI's own Keychain-based auth, spawned
 * processes fail with 401. Stripping the var lets `claude` CLI read
 * a fresh token from the Keychain on each invocation.
 */
export function getFreshEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}
