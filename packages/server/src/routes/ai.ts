import { Hono } from "hono";
import { generateTitle } from "@glue-paste-dev/core";

export function aiRoutes() {
  const app = new Hono();

  // POST /api/ai/generate-title
  app.post("/generate-title", async (c) => {
    const body = await c.req.json() as { description?: string };
    const description = body.description?.trim();
    if (!description) return c.json({ title: "" });

    const title = await generateTitle(description);
    return c.json({ title });
  });

  return app;
}
