import { getFreshEnv } from "../executor/fresh-env.js";
import type { TerminalPermissionMode } from "../schemas/config.js";
import { PtySession } from "./pty-session.js";
import { TerminalHub } from "./terminal-hub.js";

export { PtySession } from "./pty-session.js";
export { TerminalHub } from "./terminal-hub.js";
export type { SessionLike, OpenOptions, TerminalHubOptions } from "./terminal-hub.js";
export { detectPermissionPrompt } from "./permission-detector.js";
export type { PermissionPromptMatch } from "./permission-detector.js";
export { detectIdle } from "./idle-detector.js";

/** Builds a hub that spawns real interactive `claude` PTY sessions. */
export function createTerminalHub(args: {
  permissionMode: TerminalPermissionMode;
  command: string[]; // e.g. ["claude"] or ["claude","--resume",id]
  onOutput: (cardId: string, data: string) => void;
  onExit: (cardId: string, code: number) => void;
  onIdle?: (cardId: string) => void;
}): TerminalHub {
  return new TerminalHub({
    permissionMode: args.permissionMode,
    onOutput: args.onOutput,
    onExit: args.onExit,
    ...(args.onIdle ? { onIdle: args.onIdle } : {}),
    createSession: (_cardId, onData, onExit, opts) =>
      new PtySession({
        command: opts.command ?? args.command,
        cwd: opts.cwd,
        env: getFreshEnv(),
        cols: opts.cols,
        rows: opts.rows,
        onData,
        onExit,
      }),
  });
}
