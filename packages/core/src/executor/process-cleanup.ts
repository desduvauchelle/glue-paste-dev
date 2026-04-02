import { log } from "../logger.js";

/**
 * Kills a process and all its descendants synchronously.
 * Uses pkill to find and kill child processes before killing the parent.
 */
export function killProcessTreeSync(pid: number): void {
  if (pid <= 0) return;
  try {
    // Kill all child processes first
    try {
      Bun.spawnSync(["pkill", "-TERM", "-P", String(pid)]);
    } catch {
      // No children or pkill not available
    }

    // Kill the process itself
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
      return;
    }

    // Brief wait then escalate to SIGKILL
    Bun.sleepSync(500);

    // Force-kill remaining children
    try {
      Bun.spawnSync(["pkill", "-9", "-P", String(pid)]);
    } catch {
      // ignore
    }

    // Force-kill parent
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already dead
    }
  } catch (err) {
    log.warn("process-cleanup", `Failed to kill process tree for PID ${pid}:`, err);
  }
}
