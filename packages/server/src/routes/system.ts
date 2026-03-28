import { Hono } from "hono";
import { exec } from "node:child_process";
import { existsSync, statSync } from "node:fs";

export function systemRoutes() {
  const app = new Hono();

  app.post("/open-folder", async (c) => {
    const { path } = await c.req.json<{ path: string }>();
    if (!path || typeof path !== "string") {
      return c.json({ error: "Missing path" }, 400);
    }

    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return c.json({ error: "Directory not found" }, 404);
    }

    exec(`open ${JSON.stringify(path)}`);
    return c.json({ ok: true });
  });

  return app;
}
