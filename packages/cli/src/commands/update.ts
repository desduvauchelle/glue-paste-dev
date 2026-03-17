import { join } from "node:path";
import { DATA_DIR, getDaemonStatus } from "../daemon.js";
import { stop } from "./stop.js";
import { start } from "./start.js";

const REPO_DIR = join(DATA_DIR, "repo");

function exec(cmd: string[]): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(cmd, { cwd: REPO_DIR, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString().trim(),
    exitCode: result.exitCode,
  };
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      require("node:fs").readFileSync(join(REPO_DIR, "package.json"), "utf-8")
    );
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function update() {
  console.log("Checking for updates...");

  // Fetch latest from remote
  const fetch = exec(["git", "fetch", "origin"]);
  if (fetch.exitCode !== 0) {
    console.error("Failed to fetch updates. Check your internet connection.");
    process.exit(1);
  }

  // Compare local vs remote
  const localHead = exec(["git", "rev-parse", "HEAD"]).stdout;
  const remoteHead = exec(["git", "rev-parse", "origin/main"]).stdout;

  if (localHead === remoteHead) {
    const version = readVersion();
    console.log(`\x1b[32mAlready up to date.\x1b[0m (v${version})`);
    return;
  }

  const oldVersion = readVersion();

  // Stop daemon if running
  const { running } = getDaemonStatus();
  if (running) {
    await stop();
  }

  // Pull latest
  console.log("Downloading update...");
  const pull = exec(["git", "pull", "--ff-only"]);
  if (pull.exitCode !== 0) {
    console.error("Failed to pull updates. You may have local changes in the repo.");
    console.error("Run: cd ~/.glue-paste-dev/repo && git status");
    process.exit(1);
  }

  // Install dependencies
  console.log("Installing dependencies...");
  const install = exec(["bun", "install", "--ignore-scripts"]);
  if (install.exitCode !== 0) {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }

  // Rebuild
  console.log("Building...");
  const build = exec(["bun", "run", "build"]);
  if (build.exitCode !== 0) {
    console.error("Build failed. Check the logs.");
    process.exit(1);
  }

  const newVersion = readVersion();
  console.log(`\x1b[32mUpdated successfully!\x1b[0m v${oldVersion} → v${newVersion}`);

  // Restart daemon if it was running
  if (running) {
    console.log("Restarting daemon...");
    await start({ open: false });
  }
}
