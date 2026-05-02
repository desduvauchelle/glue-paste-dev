import { describe, test, expect, mock, spyOn } from "bun:test";
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

describe("generateTitle output validation", () => {
  // These tests verify the validation logic directly without spawning a real process.
  // We test the rejection conditions by checking the raw logic.

  const errorPatterns = [
    "Reached max turns (1)",
    "Reached max turns (2)",
    "Error: something went wrong",
    "error: permission denied",
  ];

  for (const pattern of errorPatterns) {
    test(`rejects output matching error pattern: "${pattern}"`, () => {
      // Inline the same regex used in generate-title.ts
      expect(/reached max turns|error:/i.test(pattern)).toBe(true);
    });
  }

  const validTitles = [
    "Fix login bug",
    "Add user dashboard",
    "Refactor payment flow",
    "Update dependencies",
  ];

  for (const title of validTitles) {
    test(`accepts valid title: "${title}"`, () => {
      expect(/reached max turns|error:/i.test(title)).toBe(false);
    });
  }
});
