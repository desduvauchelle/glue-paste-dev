import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, copyFileSync, rmSync, unlinkSync } from "node:fs";
import { DATA_DIR } from "../daemon.js";
import { stop } from "./stop.js";

const DB_FILE = join(DATA_DIR, "glue-paste-dev.db");
const DB_WAL = join(DATA_DIR, "glue-paste-dev.db-wal");
const DB_SHM = join(DATA_DIR, "glue-paste-dev.db-shm");
const SYMLINK_PATH = "/usr/local/bin/glue-paste-dev";

export async function uninstall(flags: string[]) {
  const yes = flags.includes("--yes") || flags.includes("-y");
  const keepData = flags.includes("--keep-data");

  if (!yes) {
    console.log("\x1b[1mThis will remove GluePasteDev from your system.\x1b[0m");
    if (!keepData) {
      console.log("\x1b[33mWarning: All your boards, cards, and settings will be deleted.\x1b[0m");
      console.log("Use --keep-data to back up your database before removing.");
    }
    console.log("");
    console.log("Run with --yes to confirm:");
    console.log(`  glue-paste-dev uninstall --yes`);
    console.log(`  glue-paste-dev uninstall --yes --keep-data`);
    return;
  }

  // Stop daemon
  await stop();

  // Back up database if requested
  if (keepData && existsSync(DB_FILE)) {
    const backupPath = join(homedir(), "glue-paste-dev-backup.db");
    copyFileSync(DB_FILE, backupPath);
    // Copy WAL/SHM files if they exist
    if (existsSync(DB_WAL)) copyFileSync(DB_WAL, join(homedir(), "glue-paste-dev-backup.db-wal"));
    if (existsSync(DB_SHM)) copyFileSync(DB_SHM, join(homedir(), "glue-paste-dev-backup.db-shm"));
    console.log(`\x1b[32mDatabase backed up to ${backupPath}\x1b[0m`);
  }

  // Remove installation directory
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log(`Removed ${DATA_DIR}`);
  }

  // Remove /usr/local/bin symlink
  try {
    if (existsSync(SYMLINK_PATH)) {
      unlinkSync(SYMLINK_PATH);
      console.log(`Removed ${SYMLINK_PATH}`);
    }
  } catch {
    console.log(`Could not remove ${SYMLINK_PATH} (may need sudo)`);
  }

  console.log("");
  console.log("\x1b[32mGluePasteDev has been uninstalled.\x1b[0m");
  console.log("");
  console.log("You may also want to remove the PATH entry from your shell profile:");
  console.log('  Look for "# GluePasteDev" in ~/.zshrc, ~/.bashrc, or ~/.bash_profile');
}
