import { Hono } from "hono";
import { getDataDir, log } from "@glue-paste-dev/core";
import { readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
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

/** Download a file using native fetch instead of shelling out to curl. */
async function downloadFile(url: string, destPath: string): Promise<void> {
  if (!url.startsWith("https://")) {
    throw new Error("Download URL must use HTTPS");
  }
  if (/[;|&$`(){}]/.test(url)) {
    throw new Error("Download URL contains invalid characters");
  }
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  await Bun.write(destPath, res);
}

/** Find a binary on the system by checking common paths then $PATH. */
function findBinary(name: string, extraPaths: string[] = []): string {
  const candidates = [
    ...extraPaths,
    `/usr/bin/${name}`,
    `/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  try {
    const result = Bun.spawnSync(["which", name]);
    const resolved = result.stdout.toString().trim();
    if (result.exitCode === 0 && resolved) return resolved;
  } catch { /* ignore */ }
  return name;
}

/** Build safe extract args without shell interpolation. */
export function buildExtractArgs(dataDir: string): string[] {
  return [findBinary("tar"), "-xzf", join(dataDir, "release.tar.gz"), "-C", dataDir];
}

export function updateRoutes(broadcast: (event: unknown) => void) {
  const app = new Hono();

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

  // POST /api/update/apply — download and apply update, then restart
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
    log.always("update", `apply: starting v${result.currentVersion} → v${result.latestVersion}`);
    log.always("update", `apply: dataDir=${dataDir}`);
    log.always("update", `apply: downloadUrl=${result.downloadUrl}`);

    // Download first, only delete old files after successful download
    const tarPath = join(dataDir, "release.tar.gz");
    try {
      log.always("update", `apply: downloading to ${tarPath}`);
      await downloadFile(result.downloadUrl, tarPath);
      log.always("update", "apply: download complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.alwaysError("update", `apply: download FAILED — ${msg}`, err);
      return c.json({ ok: false, error: `Download failed: ${msg}` }, 500);
    }

    // Download succeeded — now safe to delete old files and extract
    try {
      log.always("update", "apply: removing old server/ and cli/ directories");
      rmSync(join(dataDir, "server"), { recursive: true, force: true });
      rmSync(join(dataDir, "cli"), { recursive: true, force: true });
      log.always("update", "apply: old directories removed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.alwaysError("update", `apply: failed to remove old files — ${msg}`, err);
      try { rmSync(tarPath, { force: true }); } catch { /* cleanup */ }
      return c.json({ ok: false, error: `Failed to remove old version: ${msg}` }, 500);
    }

    const extractArgs = buildExtractArgs(dataDir);
    log.always("update", `apply: extracting with ${extractArgs.join(" ")}`);
    let extractFailed = false;
    let extractError = "";
    try {
      const extractProc = Bun.spawnSync(extractArgs);
      if (extractProc.exitCode !== 0) {
        extractFailed = true;
        extractError = extractProc.stderr.toString().trim() || `exit code ${extractProc.exitCode}`;
        log.alwaysError("update", `apply: tar exited with code ${extractProc.exitCode}, stderr: ${extractError}`);
      } else {
        log.always("update", "apply: extraction complete");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.alwaysError("update", `apply: tar threw exception — ${msg}`, err);
      extractFailed = true;
      extractError = msg;
    }

    try { rmSync(tarPath, { force: true }); } catch { /* non-critical */ }

    if (extractFailed) {
      return c.json({ ok: false, error: `Extract failed: ${extractError}` }, 500);
    }

    // Make CLI executable and ensure symlinks
    const cliEntry = join(dataDir, "cli", "src", "index.ts");
    log.always("update", `apply: setting permissions on ${cliEntry}`);
    try {
      Bun.spawnSync([findBinary("chmod"), "+x", cliEntry]);
    } catch (err) {
      log.alwaysError("update", "apply: chmod failed (non-critical)", err);
    }

    // Re-create bin symlink (cli/ was deleted and re-extracted)
    const binDir = join(dataDir, "bin");
    const binLink = join(binDir, "glue-paste-dev");
    try {
      mkdirSync(binDir, { recursive: true });
      try { unlinkSync(binLink); } catch { /* may not exist */ }
      symlinkSync(cliEntry, binLink);
      log.always("update", `apply: symlink created ${binLink} → ${cliEntry}`);
    } catch (err) {
      log.alwaysError("update", "apply: bin symlink failed (non-critical)", err);
    }

    // Try /usr/local/bin symlink for convenience
    try {
      const sysLink = "/usr/local/bin/glue-paste-dev";
      try { unlinkSync(sysLink); } catch { /* may not exist */ }
      symlinkSync(cliEntry, sysLink);
      log.always("update", `apply: system symlink created ${sysLink}`);
    } catch (err) {
      log.alwaysError("update", "apply: /usr/local/bin symlink failed (non-critical)", err);
    }

    log.always("update", `apply: SUCCESS v${result.currentVersion} → v${result.latestVersion}, restarting in 2s`);

    // Exit with non-zero code so daemon wrapper restarts with new code
    setTimeout(() => process.exit(1), 2000);

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
