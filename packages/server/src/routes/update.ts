import { Hono } from "hono";
import { getDataDir, log } from "@glue-paste-dev/core";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "desduvauchelle/glue-paste-dev";

function readVersion(): string {
  try {
    const pkgPath = join(getDataDir(), "package.json");
    if (!existsSync(pkgPath)) {
      log.always("update", `readVersion: package.json not found at ${pkgPath}`);
      return "unknown";
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const version = pkg.version ?? "unknown";
    log.always("update", `readVersion: ${version} (from ${pkgPath})`);
    return version;
  } catch (err) {
    log.alwaysError("update", "readVersion: failed to read package.json", err);
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
    log.always("update", `checkForUpdate: fetching https://api.github.com/repos/${REPO}/releases/latest`);
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`
    );
    if (!res.ok) {
      log.alwaysError("update", `checkForUpdate: GitHub API returned ${res.status} ${res.statusText}`);
      return null;
    }

    const release = (await res.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const latestVersion = release.tag_name.replace(/^v/, "");
    const currentVersion = readVersion();
    const asset = release.assets.find(
      (a) => a.name === "glue-paste-dev.tar.gz"
    );
    const downloadUrl = asset?.browser_download_url ?? null;

    const available = currentVersion !== latestVersion && currentVersion !== "unknown" && downloadUrl !== null;
    log.always("update", `checkForUpdate: current=${currentVersion} latest=${latestVersion} asset=${downloadUrl ? "found" : "MISSING"} available=${available}`);

    return {
      available,
      currentVersion,
      latestVersion,
      downloadUrl,
    };
  } catch (err) {
    log.alwaysError("update", "checkForUpdate: exception during update check", err);
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

/** Build safe extract args without shell interpolation. */
export function buildExtractArgs(dataDir: string): string[] {
  return ["tar", "-xzf", join(dataDir, "release.tar.gz"), "-C", dataDir];
}

/** Build CLI update command args. Exported for testing. */
export function buildCliUpdateArgs(dataDir: string): string[] {
  return ["bun", "run", join(dataDir, "cli", "src", "index.ts"), "update"];
}

export function updateRoutes(broadcast: (event: unknown) => void) {
  const app = new Hono();

  // GET /api/update/logs — return recent update-related log entries
  app.get("/logs", async (c) => {
    try {
      const logPath = join(getDataDir(), "glue-paste-dev.log");
      if (!existsSync(logPath)) {
        return c.json({ lines: [], message: "No log file found" });
      }
      const content = readFileSync(logPath, "utf-8");
      const allLines = content.split("\n");
      const updateLines = allLines.filter((line) => line.includes("[update]"));
      const last50 = updateLines.slice(-50);
      return c.json({ lines: last50 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ lines: [], message: `Failed to read logs: ${msg}` });
    }
  });

  // GET /api/update — check for updates
  app.get("/", async (c) => {
    log.always("update", "GET /api/update: check requested");
    const result = await checkForUpdate();
    if (!result) {
      log.always("update", "GET /api/update: check returned null (GitHub unreachable or error)");
      return c.json({ available: false, currentVersion: readVersion(), latestVersion: "unknown" });
    }
    setCachedResult(result);
    log.always("update", `GET /api/update: responding available=${result.available}`);
    return c.json(result);
  });

  // POST /api/update/apply — spawn CLI update command to stop, download, install, and restart
  app.post("/apply", async (c) => {
    log.always("update", "POST /api/update/apply: update apply requested");

    const cached = getCachedResult();
    log.always("update", `apply: cached result = ${cached ? `available=${cached.available} v${cached.latestVersion}` : "null (cache miss)"}`);
    const result = cached ?? await checkForUpdate();
    if (!result?.available || !result.downloadUrl) {
      log.alwaysError("update", `apply: no update available — available=${result?.available} downloadUrl=${result?.downloadUrl ?? "null"}`);
      return c.json({ ok: false, error: "No update available" }, 400);
    }

    const dataDir = getDataDir();
    const cliArgs = buildCliUpdateArgs(dataDir);
    const cliPath = cliArgs[2]!; // ~/.glue-paste-dev/cli/src/index.ts

    if (!existsSync(cliPath)) {
      log.alwaysError("update", `apply: CLI not found at ${cliPath}`);
      return c.json({ ok: false, error: "CLI not found, cannot apply update" }, 500);
    }

    log.always("update", `apply: scheduling CLI update via ${cliPath} in 500ms`);

    // Return response first so the client gets confirmation,
    // then spawn the CLI update command which stops/downloads/extracts/restarts the daemon.
    setTimeout(() => {
      log.always("update", "apply: spawning CLI update command (will stop + restart daemon)");
      const logPath = join(dataDir, "glue-paste-dev.log");
      const logFile = Bun.file(logPath);
      const proc = Bun.spawn(cliArgs, {
        cwd: dataDir,
        env: process.env,
        stdout: logFile,
        stderr: logFile,
        stdin: "ignore",
      });
      proc.unref();
    }, 500);

    return c.json({ ok: true });
  });

  return app;
}

export function startUpdateChecker(broadcast: (event: unknown) => void): ReturnType<typeof setInterval> {
  const check = async () => {
    log.always("update", "background check: starting periodic update check");
    const result = await checkForUpdate();
    if (result) setCachedResult(result);
    if (result?.available) {
      log.always("update", `background check: update available v${result.currentVersion} → v${result.latestVersion}, broadcasting`);
      broadcast({
        type: "update:available",
        payload: {
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
        },
      });
    } else {
      log.always("update", `background check: no update available (result=${result ? "checked" : "null"})`);
    }
  };

  // Initial check after 10 seconds
  setTimeout(check, 10_000);

  // Then every 30 minutes
  return setInterval(check, 30 * 60 * 1000);
}
