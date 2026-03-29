import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "fs";
import { join } from "path";
import { cleanupStaleAttachments } from "./attachments.js";

describe("cleanupStaleAttachments", () => {
  const testDir = join(import.meta.dirname, "__test-stale__");
  const attachmentsRoot = join(testDir, ".glue-paste", "attachments");

  beforeAll(() => {
    const staleDir = join(attachmentsRoot, "stale-card");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "old.png"), "data");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(join(staleDir, "old.png"), eightDaysAgo, eightDaysAgo);

    const freshDir = join(attachmentsRoot, "fresh-card");
    mkdirSync(freshDir, { recursive: true });
    writeFileSync(join(freshDir, "new.png"), "data");
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("removes attachment directories where all files are older than maxAgeDays", () => {
    cleanupStaleAttachments(testDir, 7);
    expect(existsSync(join(attachmentsRoot, "stale-card"))).toBe(false);
    expect(existsSync(join(attachmentsRoot, "fresh-card"))).toBe(true);
  });

  it("handles missing attachments directory gracefully", () => {
    expect(() => cleanupStaleAttachments("/nonexistent/path", 7)).not.toThrow();
  });
});
