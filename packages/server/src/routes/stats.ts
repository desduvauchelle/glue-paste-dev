import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { cardsDb } from "@glue-paste-dev/core";

export function statsRoutes(db: Database) {
  const app = new Hono();

  // GET /api/stats/boards — card counts grouped by board and status
  app.get("/boards", (c) => {
    return c.json(cardsDb.countCardsByStatusAllBoards(db));
  });

  // GET /api/stats/done-per-day?days=14 — completed cards per day
  app.get("/done-per-day", (c) => {
    const days = Math.min(Number(c.req.query("days")) || 14, 90);
    return c.json(cardsDb.countDonePerDay(db, days));
  });

  return app;
}
