export interface PermissionPromptMatch {
  /** Exact bytes to write to the PTY to approve once. */
  acceptInput: string;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Pattern that identifies the CLI's interactive permission prompt.
 * PLACEHOLDER — tune against the real captured prompt at E2E
 * (see docs/superpowers/spikes/2026-05-21-pty-prompt-sample.md when it exists).
 * Match against the tail only; the prompt is the most recent thing on screen.
 */
const PROMPT_PATTERN = /Do you want to proceed\?[\s\S]*1\.\s*Yes/i;

/** Keystroke(s) that select the "Yes" (approve once) option. */
const ACCEPT_INPUT = "1\r";

/** How many trailing characters of the buffer to inspect. */
const TAIL = 4000;

export function detectPermissionPrompt(buffer: string): PermissionPromptMatch | null {
  const tail = buffer.slice(-TAIL).replace(ANSI, "");
  if (PROMPT_PATTERN.test(tail)) {
    return { acceptInput: ACCEPT_INPUT };
  }
  return null;
}
