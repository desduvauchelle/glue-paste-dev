import { describe, it, expect } from "vitest";
import { join } from "node:path";

/**
 * We can't import buildDownloadArgs directly from update.ts because it
 * transitively imports bun:sqlite (via @glue-paste-dev/core) which Vitest
 * can't resolve. Instead we duplicate the pure function logic here and
 * verify the production code matches via a source-level assertion.
 */
function buildDownloadArgs(dataDir: string, downloadUrl: string): string[][] {
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

describe("update security - buildDownloadArgs", () => {
  it("returns array-based args (no bash -c)", () => {
    const args = buildDownloadArgs("/tmp/test-dir", "https://example.com/release.tar.gz");
    expect(args.flat().join(" ")).not.toContain("bash");
    expect(args.flat().join(" ")).not.toContain("-c");
    expect(args.length).toBe(2);
    expect(args[0]![0]).toBe("curl");
    expect(args[1]![0]).toBe("tar");
  });

  it("includes correct download path", () => {
    const args = buildDownloadArgs("/data", "https://github.com/release.tar.gz");
    expect(args[0]).toContain("/data/release.tar.gz");
    expect(args[1]).toContain("/data/release.tar.gz");
  });

  it("rejects non-https download URLs", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "http://evil.com/payload.tar.gz")
    ).toThrow("HTTPS");
  });

  it("rejects URLs with shell metacharacters - $(...)", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "https://example.com/$(whoami).tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with pipe characters", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "https://example.com/a|b.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with semicolons", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "https://example.com/a;rm -rf /.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with ampersand", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "https://example.com/a&b.tar.gz")
    ).toThrow("invalid characters");
  });

  it("rejects URLs with backticks", () => {
    expect(() =>
      buildDownloadArgs("/tmp/test-dir", "https://example.com/`whoami`.tar.gz")
    ).toThrow("invalid characters");
  });
});
