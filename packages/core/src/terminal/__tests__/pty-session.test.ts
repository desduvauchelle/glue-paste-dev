import { test, expect } from "bun:test";
import { PtySession } from "../pty-session.js";

test("PtySession echoes written input via onData and buffers scrollback", async () => {
  const chunks: string[] = [];
  const session = new PtySession({
    command: ["cat"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    cols: 80,
    rows: 24,
    onData: (s) => chunks.push(s),
  });

  session.write("hello\n");
  await Bun.sleep(150);

  const joined = chunks.join("");
  expect(joined).toContain("hello");
  expect(session.getScrollback()).toContain("hello");
  expect(session.isRunning()).toBe(true);

  session.kill();
  await Bun.sleep(50);
  expect(session.isRunning()).toBe(false);
});
