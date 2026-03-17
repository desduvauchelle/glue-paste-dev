import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  boardsDb,
  CreateBoardSchema,
  UpdateBoardSchema,
} from "@glue-paste-dev/core";
import type { BoardId } from "@glue-paste-dev/core";

export function boardRoutes(db: Database, broadcast: (event: unknown) => void) {
  const app = new Hono();

  // GET /api/boards
  app.get("/", (c) => {
    const boards = boardsDb.listBoards(db);
    return c.json(boards);
  });

  // POST /api/boards
  app.post("/", async (c) => {
    const body = await c.req.json();
    const parsed = CreateBoardSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const board = boardsDb.createBoard(db, parsed.data);
    return c.json(board, 201);
  });

  // GET /api/boards/:boardId
  app.get("/:boardId", (c) => {
    const board = boardsDb.getBoard(db, c.req.param("boardId") as BoardId);
    if (!board) return c.json({ error: "Board not found" }, 404);
    return c.json(board);
  });

  // PUT /api/boards/:boardId
  app.put("/:boardId", async (c) => {
    const body = await c.req.json();
    const parsed = UpdateBoardSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const board = boardsDb.updateBoard(
      db,
      c.req.param("boardId") as BoardId,
      parsed.data
    );
    if (!board) return c.json({ error: "Board not found" }, 404);
    return c.json(board);
  });

  // DELETE /api/boards/:boardId
  app.delete("/:boardId", (c) => {
    const deleted = boardsDb.deleteBoard(
      db,
      c.req.param("boardId") as BoardId
    );
    if (!deleted) return c.json({ error: "Board not found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
