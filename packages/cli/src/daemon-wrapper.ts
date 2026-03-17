#!/usr/bin/env bun
/**
 * Daemon wrapper — spawns the actual Hono server and auto-restarts on crash.
 * This process IS the daemon (its PID is stored in the PID file).
 * It supervises the child server process and restarts it with back-off.
 */
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_FILE } from "./daemon.js";

const serverPath = process.env.GPD_SERVER;
if (!serverPath) {
  process.exit(1);
}

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 60_000; // reset counter after 1 min of stability
let restartCount = 0;
let lastStart = Date.now();

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [daemon] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
}

async function runServer(): Promise<number> {
  const logFile = Bun.file(LOG_FILE);

  const proc = Bun.spawn(["bun", "run", serverPath!], {
    cwd: dirname(serverPath!),
    env: process.env,
    stdout: logFile,
    stderr: logFile,
  });

  log(`Server started (PID ${proc.pid})`);
  const exitCode = await proc.exited;
  log(`Server exited with code ${exitCode}`);
  return exitCode;
}

// Handle SIGTERM/SIGINT — clean shutdown
let shuttingDown = false;
function handleSignal(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Received ${sig}, shutting down`);
  process.exit(0);
}

process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT", () => handleSignal("SIGINT"));

// Main supervision loop
while (!shuttingDown) {
  // Reset restart counter if stable for > RESTART_WINDOW
  if (Date.now() - lastStart > RESTART_WINDOW_MS) {
    restartCount = 0;
  }

  if (restartCount >= MAX_RESTARTS) {
    log(`Too many restarts (${MAX_RESTARTS}), giving up`);
    process.exit(1);
  }

  lastStart = Date.now();
  const exitCode = await runServer();

  if (shuttingDown) break;
  if (exitCode === 0) {
    log("Server exited cleanly, stopping daemon");
    break;
  }

  restartCount++;
  const delay = Math.min(1000 * Math.pow(2, restartCount - 1), 30_000);
  log(`Restarting in ${delay}ms (attempt ${restartCount}/${MAX_RESTARTS})`);
  await new Promise((r) => setTimeout(r, delay));
}
