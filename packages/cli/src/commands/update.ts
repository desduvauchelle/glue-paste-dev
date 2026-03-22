import { DATA_DIR, getDaemonStatus } from "../daemon.js";
import { stop } from "./stop.js";
import { start } from "./start.js";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const REPO = "desduvauchelle/glue-paste-dev";

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
  console.log("Checking for updates...");

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) {
    console.error("Failed to check for updates. Check your internet connection.");
    process.exit(1);
  }

  const release = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const latestVersion = release.tag_name.replace(/^v/, "");
  const currentVersion = readVersion();

  if (currentVersion === latestVersion) {
    console.log(`\x1b[32mAlready up to date.\x1b[0m (v${currentVersion})`);
    return;
  }

  const asset = release.assets.find((a: { name: string }) => a.name === "glue-paste-dev.tar.gz");
  if (!asset) {
    console.error("Release tarball not found. Check https://github.com/" + REPO + "/releases");
    process.exit(1);
  }

  // Stop daemon if running
  const { running } = getDaemonStatus();
  if (running) {
    await stop();
  }

  console.log(`Downloading v${latestVersion}...`);

  // Download and extract (safe: no shell interpolation)
  const downloadUrl = asset.browser_download_url;
  if (!downloadUrl.startsWith("https://")) {
    console.error("Download URL must use HTTPS.");
    process.exit(1);
  }
  rmSync(join(DATA_DIR, "server"), { recursive: true, force: true });
  rmSync(join(DATA_DIR, "cli"), { recursive: true, force: true });
  const dlSteps: string[][] = [
    ["curl", "-fsSL", "-o", join(DATA_DIR, "release.tar.gz"), downloadUrl],
    ["tar", "-xzf", join(DATA_DIR, "release.tar.gz"), "-C", DATA_DIR],
  ];
  for (const args of dlSteps) {
    const proc = Bun.spawnSync(args);
    if (proc.exitCode !== 0) {
      console.error("Failed to download update.");
      process.exit(1);
    }
  }
  rmSync(join(DATA_DIR, "release.tar.gz"), { force: true });

  // Make CLI executable
  Bun.spawnSync(["chmod", "+x", join(DATA_DIR, "cli", "src", "index.ts")]);

  console.log(`\x1b[32mUpdated successfully!\x1b[0m v${currentVersion} → v${latestVersion}`);

  if (running) {
    console.log("Restarting daemon...");
    await start({ open: false });
  }
}
