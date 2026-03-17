import { existsSync } from "node:fs";
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
    console.log(`  http://localhost:${PORT}`);
    if (opts.open) openBrowser();
    return;
  }

  const serverPath = getServerPath();
  if (!existsSync(serverPath)) {
    console.error(`Server not found at ${serverPath}`);
    process.exit(1);
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
    console.log(`  http://localhost:${PORT}  (PID ${proc.pid})`);
    console.log(`  Logs: ${LOG_FILE}`);
    if (opts.open) openBrowser();
  } else {
    console.log(` \x1b[33m?\x1b[0m`);
    console.log(`  Daemon started (PID ${proc.pid}) but not yet responding.`);
    console.log(`  Check logs: ${LOG_FILE}`);
  }
}
