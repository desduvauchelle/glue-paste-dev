import { Hono } from "hono";
import { getDataDir, log } from "@glue-paste-dev/core";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const REPO = "desduvauchelle/glue-paste-dev";

function readVersion(): string {
  try {
    const pkgPath = join(getDataDir(), "package.json");
    if (!existsSync(pkgPath)) return "unknown";
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function checkForUpdate(): Promise<{
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string | null;
} | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`
    );
    if (!res.ok) return null;

    const release = (await res.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const latestVersion = release.tag_name.replace(/^v/, "");
    const currentVersion = readVersion();
    const asset = release.assets.find(
      (a) => a.name === "glue-paste-dev.tar.gz"
    );

    return {
      available: currentVersion !== latestVersion && currentVersion !== "unknown",
      currentVersion,
      latestVersion,
      downloadUrl: asset?.browser_download_url ?? null,
    };
  } catch (err) {
    log.error("update", "Failed to check for updates", err);
    return null;
  }
}

/** Build safe download+extract args without shell interpolation. */
export function buildDownloadArgs(dataDir: string, downloadUrl: string): string[][] {
  if (!downloadUrl.startsWith("https://")) {
    throw new Error("Download URL must use HTTPS");
  }
  if (/[;|&$`(){}]/.test(downloadUrl)) {
    throw new Error("Download URL contains invalid characters");
  }
  return [
    ["curl", "-fsSL", "-o", join(dataDir, "release.tar.gz"), downloadUrl],
    ["tar", "-xzf", join(dataDir, "release.tar.gz"), "-C", dataDir],
  ];
}

export function updateRoutes(broadcast: (event: unknown) => void) {
  const app = new Hono();

  // GET /api/update — check for updates
  app.get("/", async (c) => {
    const result = await checkForUpdate();
    if (!result) {
      return c.json({ available: false, currentVersion: readVersion(), latestVersion: "unknown" });
    }
    return c.json(result);
  });

  // POST /api/update/apply — download and apply update, then restart
  app.post("/apply", async (c) => {
    const result = await checkForUpdate();
    if (!result?.available || !result.downloadUrl) {
      return c.json({ ok: false, error: "No update available" }, 400);
    }

    const dataDir = getDataDir();
    log.info("update", `Applying update v${result.currentVersion} → v${result.latestVersion}`);

    rmSync(join(dataDir, "server"), { recursive: true, force: true });
    rmSync(join(dataDir, "cli"), { recursive: true, force: true });

    const steps = buildDownloadArgs(dataDir, result.downloadUrl);
    for (const args of steps) {
      const proc = Bun.spawnSync(args);
      if (proc.exitCode !== 0) {
        log.error("update", "Failed to download update");
        return c.json({ ok: false, error: "Download failed" }, 500);
      }
    }
    rmSync(join(dataDir, "release.tar.gz"), { force: true });

    // Make CLI executable
    Bun.spawnSync(["chmod", "+x", join(dataDir, "cli", "src", "index.ts")]);

    log.info("update", `Update applied: v${result.currentVersion} → v${result.latestVersion}`);

    // Exit with non-zero code so daemon wrapper restarts with new code
    setTimeout(() => process.exit(1), 500);

    return c.json({ ok: true });
  });

  return app;
}

export function startUpdateChecker(broadcast: (event: unknown) => void): ReturnType<typeof setInterval> {
  const check = async () => {
    const result = await checkForUpdate();
    if (result?.available) {
      log.info("update", `Update available: v${result.currentVersion} → v${result.latestVersion}`);
      broadcast({
        type: "update:available",
        payload: {
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
        },
      });
    }
  };

  // Initial check after 10 seconds
  setTimeout(check, 10_000);

  // Then every 30 minutes
  return setInterval(check, 30 * 60 * 1000);
}
