import { getDaemonStatus, PORT, LOG_FILE } from "../daemon.js";

export async function status(flags: string[] = []) {
  const jsonOut = flags.includes("--json");
  const { running, pid } = getDaemonStatus();

  if (!running) {
    if (jsonOut) {
      console.log(JSON.stringify({ running: false }));
    } else {
      console.log("Daemon is \x1b[31mnot running\x1b[0m");
    }
    return;
  }

  // Check HTTP health
  let healthy = false;
  let boardCount = 0;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/boards`);
    if (res.ok) {
      healthy = true;
      const boards = (await res.json()) as unknown[];
      boardCount = boards.length;
    }
  } catch {
    // not responding
  }

  if (jsonOut) {
    console.log(JSON.stringify({ running: true, healthy, pid, port: PORT, boards: boardCount, logs: LOG_FILE }));
  } else if (healthy) {
    console.log(`Daemon is \x1b[32mrunning\x1b[0m`);
    console.log(`  PID:    ${pid}`);
    console.log(`  URL:    http://localhost:${PORT}`);
    console.log(`  Boards: ${boardCount}`);
    console.log(`  Logs:   ${LOG_FILE}`);
  } else {
    console.log(`Daemon is \x1b[33mrunning but not responding\x1b[0m`);
    console.log(`  PID:  ${pid}`);
    console.log(`  Logs: ${LOG_FILE}`);
  }
}
