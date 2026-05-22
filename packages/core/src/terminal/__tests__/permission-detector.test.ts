import { test, expect } from "bun:test";
import { detectPermissionPrompt } from "../permission-detector.js";

// NOTE: placeholder sample — to be replaced with the verbatim real prompt at E2E.
const PROMPT_SAMPLE = `Do you want to proceed?
❯ 1. Yes
  2. Yes, and don't ask again this session
  3. No, and tell Claude what to do differently`;

test("detects a permission prompt and returns the accept keystroke", () => {
  const r = detectPermissionPrompt(PROMPT_SAMPLE);
  expect(r).not.toBeNull();
  expect(r!.acceptInput).toBe("1\r");
});

test("returns null for ordinary assistant output", () => {
  expect(detectPermissionPrompt("Sure, here is the file you asked for.")).toBeNull();
});

test("only matches on the tail of a larger buffer", () => {
  const buf = "lots of earlier output\n".repeat(50) + PROMPT_SAMPLE;
  expect(detectPermissionPrompt(buf)).not.toBeNull();
});
