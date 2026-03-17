import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { cardsDb, DEFAULT_TAGS, getGlobalConfig } from "@glue-paste-dev/core";
import type { BoardId } from "@glue-paste-dev/core";

export function tagRoutes(db: Database) {
  const app = new Hono();

  // GET /api/tags/defaults
  app.get("/defaults", (c) => {
    const config = getGlobalConfig(db);
    const defaults = [...DEFAULT_TAGS, ...(config.customTags ?? [])];
    return c.json([...new Set(defaults)]);
  });

  // GET /api/tags/board/:boardId
  app.get("/board/:boardId", (c) => {
    const tags = cardsDb.getDistinctTags(
      db,
      c.req.param("boardId") as BoardId
    );
    return c.json(tags);
  });

  return app;
}
