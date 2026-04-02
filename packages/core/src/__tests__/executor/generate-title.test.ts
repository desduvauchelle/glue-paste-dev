import { describe, test, expect } from "bun:test";
import { generateTitle } from "../../executor/generate-title.js";

describe("generateTitle", () => {
  test("returns empty string for empty input", async () => {
    expect(await generateTitle("")).toBe("");
  });

  test("returns empty string for whitespace-only input", async () => {
    expect(await generateTitle("   ")).toBe("");
  });

  test("returns empty string for newline-only input", async () => {
    expect(await generateTitle("\n\n")).toBe("");
  });

  test("is an async function that returns a promise", () => {
    const result = generateTitle("");
    expect(result).toBeInstanceOf(Promise);
  });
});
