import {
  getDaemonStatus,
  gracefulKill,
  removePid,
  logToFile,
} from "../daemon.js";

export async function stop() {
  const { running, pid } = getDaemonStatus();

  if (!running || pid === null) {
    console.log("Daemon is not running.");
    return;
  }

  process.stdout.write("Stopping daemon");
  logToFile("Stopping daemon...");

  await gracefulKill(pid);
  removePid();

  console.log(` \x1b[32m✓\x1b[0m  (was PID ${pid})`);
}
