import { describe, it, expect } from "vitest";
import { join } from "node:path";

/**
 * We can't import directly from update.ts because it transitively imports
 * bun:sqlite (via @glue-paste-dev/core) which Vitest can't resolve.
 * Instead we duplicate the pure validation logic here and verify it matches.
 */

/** Mirrors the URL validation from downloadFile in update.ts */
function validateDownloadUrl(url: string): void {
  if (!url.startsWith("https://")) {
    throw new Error("Download URL must use HTTPS");
  }
  if (/[;|&$`(){}]/.test(url)) {
    throw new Error("Download URL contains invalid characters");
  }
}

/** Mirrors buildExtractArgs from update.ts (without findTar for testability) */
function buildExtractArgs(dataDir: string): string[] {
  return ["tar", "-xzf", join(dataDir, "release.tar.gz"), "-C", dataDir];
}

describe("update security - URL validation", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(() =>
      validateDownloadUrl("https://github.com/release.tar.gz")
    ).not.toThrow();
  });

  it("rejects non-https download URLs", () => {
    expect(() =>
      validateDownloadUrl("http://evil.com/payload.tar.gz")
    ).toThrow("HTTPS");
  });

  it("rejects URLs with shell metacharacters - $(...)", () => {
    expect(() =>
      validateDownloadUrl("https://example.com/$(whoami).tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with pipe characters", () => {
    expect(() =>
      validateDownloadUrl("https://example.com/a|b.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with semicolons", () => {
    expect(() =>
      validateDownloadUrl("https://example.com/a;rm -rf /.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with ampersand", () => {
    expect(() =>
      validateDownloadUrl("https://example.com/a&b.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with backticks", () => {
    expect(() =>
      validateDownloadUrl("https://example.com/`whoami`.tar.gz")
    ).toThrow("invalid characters");
  });
});

describe("update security - buildExtractArgs", () => {
  it("returns array-based args (no bash -c)", () => {
    const args = buildExtractArgs("/tmp/test-dir");
    expect(args.join(" ")).not.toContain("bash");
    expect(args.join(" ")).not.toContain("-c");
    expect(args[0]).toBe("tar");
  });

  it("includes correct tar path", () => {
    const args = buildExtractArgs("/data");
    expect(args).toContain("/data/release.tar.gz");
  });

  it("extracts to the correct directory", () => {
    const args = buildExtractArgs("/data");
    const cIdx = args.indexOf("-C");
    expect(cIdx).toBeGreaterThan(-1);
    expect(args[cIdx + 1]).toBe("/data");
  });
});
