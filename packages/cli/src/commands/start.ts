import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  ensureDataDir,
  getDaemonStatus,
  getServerPath,
  writePid,
  waitForReady,
  openBrowser,
  logToFile,
  LOG_FILE,
  PORT,
} from "../daemon.js";

export async function start(opts: { open?: boolean } = { open: true }) {
  ensureDataDir();

  const { running, pid } = getDaemonStatus();
  if (running) {
    console.log(`Daemon already running (PID ${pid})`);
    console.log(`  Dashboard: \x1b[4mhttp://localhost:${PORT}\x1b[0m`);
    if (opts.open) openBrowser();
    return;
  }

  const serverPath = getServerPath();
  if (!existsSync(serverPath)) {
    console.error(`Server not found at ${serverPath}`);
    process.exit(1);
  }

  // Kill any orphaned process still holding the port
  const lsof = Bun.spawnSync(["lsof", "-ti", `:${PORT}`], { stdout: "pipe" });
  const stalePort = lsof.stdout.toString().trim();
  if (stalePort) {
    for (const p of stalePort.split("\n")) {
      try { process.kill(Number(p), "SIGKILL"); } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Persist OAuth token so the daemon can read a fresh copy at execution time
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (oauthToken) {
    const tokenFile = join(homedir(), ".glue-paste-dev", "oauth-token");
    writeFileSync(tokenFile, oauthToken, { mode: 0o600 });
  }

  logToFile("Starting daemon...");

  // Spawn as a fully detached background process via a wrapper that
  // re-spawns on crash (resilient daemon).
  const wrapperPath = new URL("../daemon-wrapper.ts", import.meta.url).pathname;

  const proc = Bun.spawn(["bun", "run", wrapperPath], {
    env: { ...process.env, PORT: String(PORT), GPD_SERVER: serverPath },
    stdout: "ignore",
    stderr: "ignore",
    stdio: ["ignore", "ignore", "ignore"],
  });

  if (!proc.pid) {
    console.error("Failed to spawn daemon");
    process.exit(1);
  }

  writePid(proc.pid);
  proc.unref();

  // Wait for ready
  process.stdout.write("Starting daemon");
  const ready = await waitForReady(8000);

  if (ready) {
    console.log(` \x1b[32m✓\x1b[0m`);
    console.log(`  Dashboard: \x1b[4mhttp://localhost:${PORT}\x1b[0m`);
    console.log(`  PID: ${proc.pid}  |  Logs: ${LOG_FILE}`);
    if (opts.open) openBrowser();
  } else {
    console.log(` \x1b[33m?\x1b[0m`);
    console.log(`  Daemon started (PID ${proc.pid}) but not yet responding.`);
    console.log(`  Check logs: ${LOG_FILE}`);
  }
}
