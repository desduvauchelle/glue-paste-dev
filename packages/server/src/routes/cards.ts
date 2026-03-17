import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  cardsDb,
  CreateCardSchema,
  UpdateCardSchema,
  MoveCardSchema,
} from "@glue-paste-dev/core";
import type { BoardId, CardId } from "@glue-paste-dev/core";

export function cardRoutes(db: Database, broadcast: (event: unknown) => void) {
  const app = new Hono();

  // GET /api/cards/board/:boardId
  app.get("/board/:boardId", (c) => {
    const cards = cardsDb.listCards(db, c.req.param("boardId") as BoardId);
    return c.json(cards);
  });

  // POST /api/cards/board/:boardId
  app.post("/board/:boardId", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCardSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const card = cardsDb.createCard(
      db,
      c.req.param("boardId") as BoardId,
      parsed.data
    );
    broadcast({ type: "card:updated", payload: card });
    return c.json(card, 201);
  });

  // GET /api/cards/:cardId
  app.get("/:cardId", (c) => {
    const card = cardsDb.getCard(db, c.req.param("cardId") as CardId);
    if (!card) return c.json({ error: "Card not found" }, 404);
    return c.json(card);
  });

  // PUT /api/cards/:cardId
  app.put("/:cardId", async (c) => {
    const body = await c.req.json();
    const parsed = UpdateCardSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const card = cardsDb.updateCard(
      db,
      c.req.param("cardId") as CardId,
      parsed.data
    );
    if (!card) return c.json({ error: "Card not found" }, 404);
    broadcast({ type: "card:updated", payload: card });
    return c.json(card);
  });

  // PATCH /api/cards/:cardId/move
  app.patch("/:cardId/move", async (c) => {
    const body = await c.req.json();
    const parsed = MoveCardSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const card = cardsDb.moveCard(
      db,
      c.req.param("cardId") as CardId,
      parsed.data
    );
    if (!card) return c.json({ error: "Card not found" }, 404);
    broadcast({ type: "card:updated", payload: card });
    return c.json(card);
  });

  // DELETE /api/cards/:cardId
  app.delete("/:cardId", (c) => {
    const cardId = c.req.param("cardId") as CardId;
    const card = cardsDb.getCard(db, cardId);
    if (!card) return c.json({ error: "Card not found" }, 404);
    const deleted = cardsDb.deleteCard(db, cardId);
    if (!deleted) return c.json({ error: "Card not found" }, 404);
    broadcast({ type: "card:deleted", payload: { cardId: card.id, boardId: card.board_id } });
    return c.json({ ok: true });
  });

  return app;
}
