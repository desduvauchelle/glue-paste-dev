import { log } from "../logger.js";

export interface PtySessionOptions {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  cols: number;
  rows: number;
  /** Called with every decoded output chunk from the PTY. */
  onData: (chunk: string) => void;
  /** Called once when the child exits. */
  onExit?: (exitCode: number) => void;
}

/** Max bytes of recent output kept for replay when a client (re)attaches. */
const SCROLLBACK_MAX = 256 * 1024;

/**
 * Wraps a single interactive child process running under a Bun pseudo-terminal.
 * The child sees a real TTY (isTTY === true), so CLIs render their interactive UI.
 */
export class PtySession {
  private proc: ReturnType<typeof Bun.spawn>;
  private decoder = new TextDecoder();
  private scrollback = "";
  private running = true;
  private exitCode: number | null = null;

  constructor(private opts: PtySessionOptions) {
    this.proc = Bun.spawn(opts.command, {
      cwd: opts.cwd,
      env: opts.env,
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data: (_term, bytes: Uint8Array) => {
          const text = this.decoder.decode(bytes, { stream: true });
          this.appendScrollback(text);
          opts.onData(text);
        },
      },
    });

    this.proc.exited.then((code) => {
      this.running = false;
      this.exitCode = code;
      log.info("pty", `session exited code=${code} cmd=${opts.command[0]}`);
      opts.onExit?.(code);
    });
  }

  private appendScrollback(text: string): void {
    this.scrollback += text;
    if (this.scrollback.length > SCROLLBACK_MAX) {
      this.scrollback = this.scrollback.slice(-SCROLLBACK_MAX);
    }
  }

  /** Write raw input (keystrokes / a prompt line ending in "\r") to the PTY. */
  write(data: string): void {
    if (!this.running) return;
    this.proc.terminal?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.running) return;
    this.proc.terminal?.resize(cols, rows);
  }

  getScrollback(): string {
    return this.scrollback;
  }

  isRunning(): boolean {
    return this.running;
  }

  getExitCode(): number | null {
    return this.exitCode;
  }

  get pid(): number | undefined {
    return this.proc.pid;
  }

  kill(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.proc.terminal?.close();
    } catch {
      // already closed
    }
    try {
      this.proc.kill();
    } catch {
      // already dead
    }
  }
}
