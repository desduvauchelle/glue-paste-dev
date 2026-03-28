import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  getGlobalConfig,
  getMergedConfig,
  getProjectConfigRaw,
  updateGlobalConfig,
  updateProjectConfig,
  ConfigInputSchema,
  refreshConcurrency,
  getRunningQueueBoardIds,
} from "@glue-paste-dev/core";
import type { BoardId } from "@glue-paste-dev/core";
import { makeCallbacks } from "../callbacks.js";

export function configRoutes(db: Database, broadcast: (event: unknown) => void) {
  const app = new Hono();
  const callbacks = makeCallbacks(db, broadcast);

  // GET /api/config
  app.get("/", (c) => {
    const config = getGlobalConfig(db);
    return c.json(config);
  });

  // PUT /api/config
  app.put("/", async (c) => {
    const body = await c.req.json();
    const parsed = ConfigInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const config = updateGlobalConfig(db, parsed.data);

    // Global config change may affect all running queues
    if (parsed.data.maxConcurrentCards !== undefined) {
      for (const boardId of getRunningQueueBoardIds()) {
        refreshConcurrency(db, boardId, callbacks);
      }
    }

    return c.json(config);
  });

  // GET /api/config/board/:boardId
  app.get("/board/:boardId", (c) => {
    const config = getMergedConfig(
      db,
      c.req.param("boardId") as BoardId
    );
    return c.json(config);
  });

  // GET /api/config/board/:boardId/raw — project-only overrides (nulls = inherit)
  app.get("/board/:boardId/raw", (c) => {
    const raw = getProjectConfigRaw(
      db,
      c.req.param("boardId") as BoardId
    );
    return c.json(raw ?? {});
  });

  // PUT /api/config/board/:boardId
  app.put("/board/:boardId", async (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const body = await c.req.json();
    const parsed = ConfigInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const config = updateProjectConfig(db, boardId, parsed.data);

    // Board-specific config change — refresh that board's concurrency
    if (parsed.data.maxConcurrentCards !== undefined) {
      refreshConcurrency(db, boardId, callbacks);
    }

    return c.json(config);
  });

  return app;
}
