import { Hono } from "hono";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TOKEN_FILE = join(homedir(), ".glue-paste-dev", "oauth-token");

export function authRoutes() {
  const app = new Hono();

  /** POST /api/auth/token — store a fresh OAuth token for CLI subprocesses */
  app.post("/token", async (c) => {
    const body = await c.req.json<{ token?: string }>();
    if (!body.token) {
      return c.json({ error: "token is required" }, 400);
    }
    writeFileSync(TOKEN_FILE, body.token);
    return c.json({ ok: true });
  });

  return app;
}
