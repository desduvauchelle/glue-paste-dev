import { DATA_DIR, getDaemonStatus } from "../daemon.js";
import { stop } from "./stop.js";
import { start } from "./start.js";
import { readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "desduvauchelle/glue-paste-dev";

function logUpdate(msg: string): void {
  try {
    appendFileSync(
      join(DATA_DIR, "glue-paste-dev.log"),
      `[${new Date().toISOString()}] [INF] [update] ${msg}\n`
    );
  } catch {
    // Best-effort: don't crash update if logging fails
  }
}

export function readVersion(): string {
  try {
    const pkgPath = join(DATA_DIR, "package.json");
    if (!existsSync(pkgPath)) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function update() {
  logUpdate("update: starting");
  console.log("Checking for updates...");

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) {
    logUpdate(`update: GitHub API error ${res.status} ${res.statusText}`);
    console.error("Failed to check for updates. Check your internet connection.");
    process.exit(1);
  }

  const release = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const latestVersion = release.tag_name.replace(/^v/, "");
  const currentVersion = readVersion();

  if (currentVersion === latestVersion) {
    logUpdate(`update: already up to date (v${currentVersion})`);
    console.log(`\x1b[32mAlready up to date.\x1b[0m (v${currentVersion})`);
    return;
  }

  const asset = release.assets.find((a: { name: string }) => a.name === "glue-paste-dev.tar.gz");
  if (!asset) {
    logUpdate(`update: tarball not found in release assets for v${latestVersion}`);
    console.error("Release tarball not found. Check https://github.com/" + REPO + "/releases");
    process.exit(1);
  }

  // Stop daemon if running
  const { running } = getDaemonStatus();
  if (running) {
    logUpdate("update: stopping daemon");
    await stop();
    logUpdate("update: daemon stopped");
  }

  logUpdate(`update: downloading v${latestVersion}`);
  console.log(`Downloading v${latestVersion}...`);

  // Download and extract (safe: no shell interpolation)
  const downloadUrl = asset.browser_download_url;
  if (!downloadUrl.startsWith("https://")) {
    logUpdate("update: rejected non-HTTPS download URL");
    console.error("Download URL must use HTTPS.");
    process.exit(1);
  }
  // Download first, only delete old files after successful download
  const tarPath = join(DATA_DIR, "release.tar.gz");
  const dlProc = Bun.spawnSync(["curl", "-fsSL", "-o", tarPath, downloadUrl]);
  if (dlProc.exitCode !== 0) {
    logUpdate(`update: curl failed with exit code ${dlProc.exitCode}`);
    console.error("Failed to download update.");
    process.exit(1);
  }
  logUpdate("update: download complete");

  // Download succeeded — now safe to delete old files and extract
  rmSync(join(DATA_DIR, "server"), { recursive: true, force: true });
  rmSync(join(DATA_DIR, "cli"), { recursive: true, force: true });
  const extractProc = Bun.spawnSync(["tar", "-xzf", tarPath, "-C", DATA_DIR]);
  if (extractProc.exitCode !== 0) {
    logUpdate(`update: tar extraction failed with exit code ${extractProc.exitCode}`);
    console.error("Failed to extract update.");
    process.exit(1);
  }
  logUpdate("update: extraction complete");
  rmSync(join(DATA_DIR, "release.tar.gz"), { force: true });

  // Make CLI executable
  const cliEntry = join(DATA_DIR, "cli", "src", "index.ts");
  Bun.spawnSync(["chmod", "+x", cliEntry]);

  // Ensure bin symlink exists (re-create after cli/ was deleted and re-extracted)
  const binDir = join(DATA_DIR, "bin");
  const binLink = join(binDir, "glue-paste-dev");
  mkdirSync(binDir, { recursive: true });
  try { unlinkSync(binLink); } catch { /* may not exist */ }
  symlinkSync(cliEntry, binLink);

  // Try /usr/local/bin symlink for convenience (may fail without sudo)
  try {
    const sysLink = "/usr/local/bin/glue-paste-dev";
    try { unlinkSync(sysLink); } catch { /* may not exist */ }
    symlinkSync(cliEntry, sysLink);
  } catch { /* not critical — ~/.glue-paste-dev/bin is the primary PATH entry */ }

  logUpdate(`update: updated successfully v${currentVersion} → v${latestVersion}`);
  console.log(`\x1b[32mUpdated successfully!\x1b[0m v${currentVersion} → v${latestVersion}`);

  if (running) {
    logUpdate("update: restarting daemon");
    console.log("Restarting daemon...");
    await start({ open: false });
    logUpdate("update: daemon restart initiated");
  }
}
