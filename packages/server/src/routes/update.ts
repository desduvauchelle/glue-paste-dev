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

// Cache the last successful update check so POST /apply doesn't need a redundant GitHub call
let cachedResult: {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string | null;
} | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedResult() {
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL) return cachedResult;
  return null;
}

function setCachedResult(result: NonNullable<typeof cachedResult>) {
  cachedResult = result;
  cachedAt = Date.now();
}

/** Build safe download+extract args without shell interpolation. */
export function buildDownloadArgs(dataDir: string, downloadUrl: string): [string[], string[]] {
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
    setCachedResult(result);
    return c.json(result);
  });

  // POST /api/update/apply — download and apply update, then restart
  app.post("/apply", async (c) => {
    // Use cached result from the GET check to avoid a redundant GitHub API call
    const result = getCachedResult() ?? await checkForUpdate();
    if (!result?.available || !result.downloadUrl) {
      return c.json({ ok: false, error: "No update available" }, 400);
    }

    const dataDir = getDataDir();
    log.info("update", `Applying update v${result.currentVersion} → v${result.latestVersion}`);

    // Download first, only delete old files after successful download
    const tarPath = join(dataDir, "release.tar.gz");
    const [dlArgs, extractArgs] = buildDownloadArgs(dataDir, result.downloadUrl);
    const dlProc = Bun.spawnSync(dlArgs);
    if (dlProc.exitCode !== 0) {
      log.error("update", "Failed to download update");
      return c.json({ ok: false, error: "Download failed" }, 500);
    }

    // Download succeeded — now safe to delete old files and extract
    rmSync(join(dataDir, "server"), { recursive: true, force: true });
    rmSync(join(dataDir, "cli"), { recursive: true, force: true });

    const extractProc = Bun.spawnSync(extractArgs);
    if (extractProc.exitCode !== 0) {
      log.error("update", "Failed to extract update");
      return c.json({ ok: false, error: "Extract failed" }, 500);
    }
    rmSync(tarPath, { force: true });

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
    if (result) setCachedResult(result);
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
