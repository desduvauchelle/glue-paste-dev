import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  isCaffeinateActive,
  startCaffeinate,
  stopCaffeinate,
  getActiveBoardDetails,
} from "../caffeinate.js";

export function caffeinateRoutes(db: Database) {
  const app = new Hono();

  // GET /api/caffeinate
  app.get("/", (c) => {
    return c.json({
      active: isCaffeinateActive(),
      activeBoards: getActiveBoardDetails(db),
    });
  });

  // POST /api/caffeinate — manually start
  app.post("/", (c) => {
    startCaffeinate();
    return c.json({ active: isCaffeinateActive() });
  });

  // DELETE /api/caffeinate — manually stop
  app.delete("/", (c) => {
    stopCaffeinate();
    return c.json({ active: false });
  });

  return app;
}
