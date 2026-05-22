// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** How many trailing characters of the buffer to inspect. */
const TAIL = 2000;

/**
 * Best-effort idle/turn-complete detector.
 *
 * Real TUI output (from spike 2026-05-22): after ANSI-stripping and whitespace
 * collapsing, the ready input box appears as "❯Try\"create a util...\"" or a
 * lone "❯". Working state shows spinner glyphs (✻✽✶✳✢·) but no input-box caret.
 * Permission menus show "❯1.Yes" / "❯2.…" — digit immediately after ❯.
 *
 * Heuristics (all must hold):
 *   1. Tail contains ❯ NOT immediately followed by a digit (input box, not a menu).
 *   2. Tail does NOT contain "doyouwantto" (not a permission prompt).
 *
 * NOTE: the post-turn idle state (after a task completes) was NOT captured in the
 * spike — both runs stalled at the permission prompt. The pattern here is based on
 * the pre-prompt ready state (same ❯ input box). Confirm at E2E.
 */
export function detectIdle(buffer: string): boolean {
  if (!buffer) return false;

  const flat = buffer.slice(-TAIL).replace(ANSI, "").replace(/\s+/g, "");

  // Must have input-box caret not followed by a digit
  if (!/❯(?![0-9])/.test(flat)) return false;

  // Must not be a permission prompt
  if (/doyouwantto/i.test(flat)) return false;

  return true;
}
