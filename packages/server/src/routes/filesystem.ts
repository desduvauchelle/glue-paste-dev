import { Hono } from "hono";
import { readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { homedir } from "node:os";

export function filesystemRoutes() {
  const app = new Hono();

  // GET /api/filesystem/browse?path=/some/path
  // Returns list of directories at the given path
  app.get("/browse", async (c) => {
    const requestedPath = c.req.query("path") || homedir();
    const resolved = resolve(requestedPath);

    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const directories = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      return c.json({
        current: resolved,
        parent: resolved === sep ? null : resolve(resolved, ".."),
        directories,
      });
    } catch {
      return c.json({ error: "Cannot read directory" }, 400);
    }
  });

  return app;
}
