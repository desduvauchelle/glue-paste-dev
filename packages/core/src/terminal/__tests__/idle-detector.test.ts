import { test, expect } from "bun:test";
import { detectIdle } from "../idle-detector.js";

// Space-less idle samples from the spike (2026-05-22):
// The ready/idle input box renders as "❯ Try "create..." after ANSI-stripping,
// which collapses to "❯Try\"create..." after whitespace removal.
const IDLE_SAMPLE = '❯Try"createautillogging.pythat..."';

// Minimal idle — just the caret by itself (empty input box)
const IDLE_MINIMAL = "❯";

// Permission prompt sample — should NOT trigger idle
const PERMISSION_SAMPLE =
  "Doyouwanttocreatehello.txt?❯1.Yes2.Yes,allowalleditsduringthissession3.No";

// Mid-stream working sample with spinner glyphs and no input box
const WORKING_SAMPLE =
  "✻thinkingwithhigheffort✽✶✳✢·Propagating\x1b]0;⠂gluepaste\x07";

test("returns true for idle input-box sample", () => {
  expect(detectIdle(IDLE_SAMPLE)).toBe(true);
});

test("returns true for minimal idle (bare ❯)", () => {
  expect(detectIdle(IDLE_MINIMAL)).toBe(true);
});

test("returns false for permission-prompt sample (has ❯ but is a menu)", () => {
  expect(detectIdle(PERMISSION_SAMPLE)).toBe(false);
});

test("returns false for mid-stream working sample (spinner, no input box)", () => {
  expect(detectIdle(WORKING_SAMPLE)).toBe(false);
});

test("returns false for empty buffer", () => {
  expect(detectIdle("")).toBe(false);
});

test("returns false for ordinary text without ❯", () => {
  expect(detectIdle("Sure, here is the file you asked for.")).toBe(false);
});

test("handles ANSI escape codes (strips them before matching)", () => {
  // ANSI-wrapped idle input box
  const ansiIdle = "\x1b[32m❯\x1b[0m Try \"create a util...\"";
  expect(detectIdle(ansiIdle)).toBe(true);
});
