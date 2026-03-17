import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { executionsDb } from "@glue-paste-dev/core";
import type { CardId, ExecutionId } from "@glue-paste-dev/core";

export function executionRoutes(db: Database) {
  const app = new Hono();

  // GET /api/executions/card/:cardId
  app.get("/card/:cardId", (c) => {
    const executions = executionsDb.listExecutions(
      db,
      c.req.param("cardId") as CardId
    );
    return c.json(executions);
  });

  // GET /api/executions/:executionId
  app.get("/:executionId", (c) => {
    const execution = executionsDb.getExecution(
      db,
      c.req.param("executionId") as ExecutionId
    );
    if (!execution) return c.json({ error: "Execution not found" }, 404);
    return c.json(execution);
  });

  return app;
}
