import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { cardsDb } from "@glue-paste-dev/core";

export function statsRoutes(db: Database) {
  const app = new Hono();

  // GET /api/stats/boards — card counts grouped by board and status
  app.get("/boards", (c) => {
    return c.json(cardsDb.countCardsByStatusAllBoards(db));
  });

  // GET /api/stats/done-per-day?days=14&tzOffset=0 — completed cards per day
  app.get("/done-per-day", (c) => {
    const days = Math.min(Number(c.req.query("days")) || 14, 90);
    const tzOffset = Number(c.req.query("tzOffset")) || 0;
    return c.json(cardsDb.countDonePerDay(db, days, tzOffset));
  });

  // GET /api/stats/done-per-day-by-board?days=14&tzOffset=0 — completed cards per day per board
  app.get("/done-per-day-by-board", (c) => {
    const days = Math.min(Number(c.req.query("days")) || 14, 90);
    const tzOffset = Number(c.req.query("tzOffset")) || 0;
    return c.json(cardsDb.countDonePerDayByBoard(db, days, tzOffset));
  });

  return app;
}
