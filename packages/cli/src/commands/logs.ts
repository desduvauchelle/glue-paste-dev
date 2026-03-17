import { existsSync } from "node:fs";
import { LOG_FILE } from "../daemon.js";

export async function logs(follow: boolean) {
  if (!existsSync(LOG_FILE)) {
    console.log("No logs yet.");
    return;
  }

  if (follow) {
    // Tail -f using Bun subprocess
    const proc = Bun.spawn(["tail", "-f", "-n", "50", LOG_FILE], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  } else {
    // Show last 50 lines
    const proc = Bun.spawn(["tail", "-n", "50", LOG_FILE], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
  }
}
