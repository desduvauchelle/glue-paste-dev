import { Hono } from "hono";
import { isCaffeinateActive, startCaffeinate, stopCaffeinate } from "../caffeinate.js";

export function caffeinateRoutes() {
  const app = new Hono();

  // GET /api/caffeinate
  app.get("/", (c) => {
    return c.json({ active: isCaffeinateActive() });
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
