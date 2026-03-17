import { join } from "node:path";
import { homedir } from "node:os";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  appendFileSync,
} from "node:fs";

const DATA_DIR = join(homedir(), ".glue-paste-dev");
const PID_FILE = join(DATA_DIR, "glue-paste-dev.pid");
const LOG_FILE = join(DATA_DIR, "glue-paste-dev.log");
const PORT = 4242;

export { DATA_DIR, PID_FILE, LOG_FILE, PORT };

export function ensureDataDir(): void {
  mkdirSync(DATA_DIR, { recursive: true });
}

export function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

export function writePid(pid: number): void {
  writeFileSync(PID_FILE, String(pid));
}

export function removePid(): void {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if the daemon is currently running. Cleans stale PID files. */
export function getDaemonStatus(): { running: boolean; pid: number | null } {
  const pid = readPid();
  if (pid === null) return { running: false, pid: null };
  if (isAlive(pid)) return { running: true, pid };
  // Stale PID file
  removePid();
  return { running: false, pid: null };
}

export function getServerPath(): string {
  // Bundled release: server/index.js sits next to cli/
  const bundled = join(import.meta.dir, "..", "..", "server", "index.js");
  if (existsSync(bundled)) return bundled;
  // Dev: full repo layout
  return join(import.meta.dir, "..", "..", "server", "src", "index.ts");
}

/** Wait for server to respond on the health endpoint */
export async function waitForReady(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/boards`);
      if (res.ok) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** Gracefully kill a process, wait for it to exit, force-kill if needed */
export async function gracefulKill(pid: number, timeoutMs = 5000): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already dead
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Force kill
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

export function openBrowser(): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  Bun.spawn([cmd, `http://localhost:${PORT}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function logToFile(msg: string): void {
  appendFileSync(LOG_FILE, `[${timestamp()}] ${msg}\n`);
}
