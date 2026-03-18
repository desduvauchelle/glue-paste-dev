import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  cardsDb,
  boardsDb,
  commentsDb,
  runChat,
  killChatProcess,
  hasChatProcess,
  getMergedConfig,
} from "@glue-paste-dev/core";
import type { CardId, ChatCallbacks } from "@glue-paste-dev/core";

export function chatRoutes(
  db: Database,
  broadcast: (event: unknown) => void
) {
  const app = new Hono();

  // POST /api/cards/:cardId/chat
  app.post("/:cardId/chat", async (c) => {
    const cardId = c.req.param("cardId") as CardId;
    const card = cardsDb.getCard(db, cardId);
    if (!card) return c.json({ error: "Card not found" }, 404);

    if (hasChatProcess(card.id)) {
      return c.json({ error: "Chat already in progress for this card" }, 409);
    }

    const body = await c.req.json() as {
      message: string;
      mode: "plan" | "execute";
      thinking: "smart" | "basic";
    };

    if (!body.message?.trim()) {
      return c.json({ error: "Message is required" }, 400);
    }

    const board = boardsDb.getBoard(db, card.board_id);
    if (!board) return c.json({ error: "Board not found" }, 404);

    const config = getMergedConfig(db, card.board_id);
    const comments = commentsDb.listComments(db, cardId);

    const callbacks: ChatCallbacks = {
      onOutput(cardId, chunk) {
        broadcast({
          type: "chat:output",
          payload: { cardId, chunk },
        });
      },
      onCompleted(cardId, comment) {
        broadcast({
          type: "chat:completed",
          payload: { cardId, commentId: comment.id },
        });
      },
      onCommentAdded(comment) {
        broadcast({ type: "comment:added", payload: comment });
      },
    };

    // Run chat in background (don't await)
    void runChat(db, {
      card,
      board,
      comments,
      config,
      mode: body.mode ?? "plan",
      userMessage: body.message,
      thinking: body.thinking ?? "smart",
    }, callbacks);

    return c.json({ ok: true });
  });

  // DELETE /api/cards/:cardId/chat - stop chat
  app.delete("/:cardId/chat", (c) => {
    const cardId = c.req.param("cardId");
    const killed = killChatProcess(cardId);
    return c.json({ ok: true, killed });
  });

  return app;
}
