import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { commentsDb, CreateCommentSchema } from "@glue-paste-dev/core";
import type { CardId } from "@glue-paste-dev/core";

export function commentRoutes(
  db: Database,
  broadcast: (event: unknown) => void
) {
  const app = new Hono();

  // GET /api/comments/card/:cardId
  app.get("/card/:cardId", (c) => {
    const comments = commentsDb.listComments(
      db,
      c.req.param("cardId") as CardId
    );
    return c.json(comments);
  });

  // POST /api/comments/card/:cardId
  app.post("/card/:cardId", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCommentSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const comment = commentsDb.createComment(
      db,
      c.req.param("cardId") as CardId,
      parsed.data
    );
    broadcast({ type: "comment:added", payload: comment });
    return c.json(comment, 201);
  });

  return app;
}
