export interface PermissionPromptMatch {
  /** Exact bytes to write to the PTY to approve once. */
  acceptInput: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Pattern that identifies the CLI's interactive permission prompt.
 *
 * Real TUI output (from spike 2026-05-22): the cursor-repainted terminal strips
 * down to space-less text like "Doyouwanttocreatehello.txt?❯1.Yes2.Yes,...3.No".
 * We strip ALL whitespace before matching so the pattern is whitespace-insensitive.
 *
 * We require BOTH:
 *   1. "doyouwantto" — the question preamble (covers create/edit/run/etc.)
 *   2. "1.?yes" — the Yes option in the numbered menu (reduces false positives)
 */
const QUESTION_PATTERN = /doyouwantto/i;
const YES_OPTION_PATTERN = /1\.?yes/i;

/** Enter key — selects the highlighted (❯) Yes option. NOT "1\r". */
const ACCEPT_INPUT = "\r";

/** How many trailing characters of the buffer to inspect. */
const TAIL = 4000;

export function detectPermissionPrompt(buffer: string): PermissionPromptMatch | null {
  const flat = buffer.slice(-TAIL).replace(ANSI, "").replace(/\s+/g, "");
  if (QUESTION_PATTERN.test(flat) && YES_OPTION_PATTERN.test(flat)) {
    return { acceptInput: ACCEPT_INPUT };
  }
  return null;
}
