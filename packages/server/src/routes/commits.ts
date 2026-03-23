import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { commitsDb } from "@glue-paste-dev/core";
import type { CardId } from "@glue-paste-dev/core";

export function commitRoutes(db: Database) {
  const app = new Hono();

  // GET /api/commits/card/:cardId
  app.get("/card/:cardId", (c) => {
    const commits = commitsDb.listCommits(
      db,
      c.req.param("cardId") as CardId
    );
    return c.json(commits);
  });

  return app;
}
