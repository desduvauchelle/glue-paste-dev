import { test, expect } from "bun:test";
import { detectPermissionPrompt } from "../permission-detector.js";

// Realistic space-less sample from the spike (2026-05-22): ANSI-stripped TUI output
// jams words together. The raw PTY tail looks like:
//   "Doyouwanttocreatehello.txt?❯1.Yes2.Yes,allowalleditsduringthissession3.No"
const PROMPT_SAMPLE =
  "Doyouwanttocreatehello.txt?❗\n❯1.Yes\n2.Yes,allowalleditsduringthissession(shift+tab)\n3.No\nEsctocancels\xb7Tabtoamend";

// Simpler canonical form used in most tests
const PROMPT_FLAT = "Doyouwanttocreatehello.txt?❯1.Yes2.Yes,allowalleditsduringthissession3.No";

test("detects a permission prompt and returns Enter as the accept keystroke", () => {
  const r = detectPermissionPrompt(PROMPT_FLAT);
  expect(r).not.toBeNull();
  expect(r!.acceptInput).toBe("\r");
});

test("accept key is \\r (Enter), not '1\\r'", () => {
  const r = detectPermissionPrompt(PROMPT_SAMPLE);
  expect(r).not.toBeNull();
  expect(r!.acceptInput).toBe("\r");
  expect(r!.acceptInput).not.toBe("1\r");
});

test("returns null for ordinary assistant output", () => {
  expect(detectPermissionPrompt("Sure, here is the file you asked for.")).toBeNull();
});

test("only matches on the tail of a larger buffer", () => {
  const buf = "lots of earlier output\n".repeat(50) + PROMPT_FLAT;
  expect(detectPermissionPrompt(buf)).not.toBeNull();
});

test("does NOT match when there is no yes-option (reduces false positives)", () => {
  // Has 'doyouwantto' but no '1.yes' — should not match
  expect(detectPermissionPrompt("doyouwanttodothis")).toBeNull();
});

test("handles ANSI escape codes in the buffer (strips them before matching)", () => {
  const ansiWrapped =
    "\x1b[32mDoyouwanttocreatehello.txt?\x1b[0m\x1b[1m❯1.Yes\x1b[0m2.No";
  const r = detectPermissionPrompt(ansiWrapped);
  expect(r).not.toBeNull();
  expect(r!.acceptInput).toBe("\r");
});
