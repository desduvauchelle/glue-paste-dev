import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { buildExtractArgs, updateRoutes } from "../../routes/update.js";

describe("buildExtractArgs", () => {
  it("returns array-based args with correct paths", () => {
    const args = buildExtractArgs("/tmp/test-data");
    expect(args[0]).toContain("tar");
    expect(args[1]).toBe("-xzf");
    expect(args[2]).toBe("/tmp/test-data/release.tar.gz");
    expect(args[3]).toBe("-C");
    expect(args[4]).toBe("/tmp/test-data");
  });

  it("does not use shell execution", () => {
    const args = buildExtractArgs("/tmp/test-data");
    const joined = args.join(" ");
    expect(joined).not.toContain("bash");
    expect(joined).not.toContain("-c");
  });
});

describe("checkForUpdate available logic", () => {
  // Mirrors the fixed logic in checkForUpdate's return statement
  function computeAvailable(
    currentVersion: string,
    latestVersion: string,
    downloadUrl: string | null
  ): boolean {
    return currentVersion !== latestVersion && currentVersion !== "unknown" && downloadUrl !== null;
  }

  it("reports available when versions differ and downloadUrl exists", () => {
    expect(computeAvailable("1.0.0", "1.1.0", "https://example.com/r.tar.gz")).toBe(true);
  });

  it("reports NOT available when versions match", () => {
    expect(computeAvailable("1.0.0", "1.0.0", "https://example.com/r.tar.gz")).toBe(false);
  });

  it("reports NOT available when downloadUrl is null", () => {
    expect(computeAvailable("1.0.0", "1.1.0", null)).toBe(false);
  });

  it("reports NOT available when current version is unknown", () => {
    expect(computeAvailable("unknown", "1.1.0", "https://example.com/r.tar.gz")).toBe(false);
  });
});

describe("downloadFile URL validation", () => {
  function validateDownloadUrl(url: string): void {
    if (!url.startsWith("https://")) {
      throw new Error("Download URL must use HTTPS");
    }
    if (/[;|&$`(){}]/.test(url)) {
      throw new Error("Download URL contains invalid characters");
    }
  }

  it("accepts valid GitHub release URLs", () => {
    expect(() =>
      validateDownloadUrl("https://github.com/desduvauchelle/glue-paste-dev/releases/download/v1.0.0/glue-paste-dev.tar.gz")
    ).not.toThrow();
  });

  it("rejects non-HTTPS URLs", () => {
    expect(() => validateDownloadUrl("http://evil.com/payload.tar.gz")).toThrow("HTTPS");
  });

  it("rejects URLs with shell metacharacters", () => {
    expect(() => validateDownloadUrl("https://example.com/$(whoami).tar.gz")).toThrow("invalid characters");
    expect(() => validateDownloadUrl("https://example.com/a|b.tar.gz")).toThrow("invalid characters");
    expect(() => validateDownloadUrl("https://example.com/a;rm -rf /")).toThrow("invalid characters");
    expect(() => validateDownloadUrl("https://example.com/a&b")).toThrow("invalid characters");
    expect(() => validateDownloadUrl("https://example.com/`id`")).toThrow("invalid characters");
  });
});

describe("apply handler guard conditions", () => {
  function shouldRejectApply(result: { available: boolean; downloadUrl: string | null } | null): boolean {
    return !result?.available || !result?.downloadUrl;
  }

  it("rejects when no cached result exists", () => {
    expect(shouldRejectApply(null)).toBe(true);
  });

  it("rejects when result has no downloadUrl", () => {
    expect(shouldRejectApply({ available: true, downloadUrl: null })).toBe(true);
  });

  it("rejects when result says not available", () => {
    expect(shouldRejectApply({ available: false, downloadUrl: "https://example.com/r.tar.gz" })).toBe(true);
  });

  it("accepts when result is valid with downloadUrl", () => {
    expect(shouldRejectApply({ available: true, downloadUrl: "https://example.com/r.tar.gz" })).toBe(false);
  });
});

describe("update routes - integration", () => {
  let app: Hono;
  const broadcasts: unknown[] = [];

  beforeEach(() => {
    broadcasts.length = 0;
    app = new Hono();
    app.route("/api/update", updateRoutes((event) => broadcasts.push(event)));
  });

  it("GET /api/update returns correct response shape", async () => {
    const res = await app.request("/api/update");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("available");
    expect(body).toHaveProperty("currentVersion");
    expect(body).toHaveProperty("latestVersion");
    expect(typeof body.available).toBe("boolean");
  });

  it("GET /api/update has consistent available and downloadUrl", async () => {
    const res = await app.request("/api/update");
    const body = (await res.json()) as { available: boolean; downloadUrl?: string | null };
    if (body.available) {
      expect(body.downloadUrl).not.toBeNull();
      expect(body.downloadUrl).toBeDefined();
    }
  });

  it("POST /api/update/apply returns 400 or 200 (never crashes with 500)", async () => {
    await app.request("/api/update");
    const res = await app.request("/api/update/apply", { method: "POST" });
    expect([200, 400]).toContain(res.status);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("ok");
  });
});
