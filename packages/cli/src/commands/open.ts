import { getDaemonStatus, openBrowser, PORT } from "../daemon.js";
import { start } from "./start.js";

export async function open() {
  const { running } = getDaemonStatus();

  if (!running) {
    // Auto-start if not running
    await start({ open: true });
    return;
  }

  console.log(`Opening http://localhost:${PORT}`);
  openBrowser();
}
