import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb, executionsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { executionRoutes } from "../../routes/executions.js";

let app: Hono;
let db: Database;
let cardId: string;

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test",
    description: "",
    directory: "/tmp/test",
  });
  const card = cardsDb.createCard(db, board.id as any, {
    title: "Test Card",
    tags: [],
  });
  cardId = card.id;

  app = new Hono();
  app.route("/api/executions", executionRoutes(db));
});

function req(method: string, path: string) {
  return app.request(`http://localhost/api/executions${path}`, { method });
}

describe("execution routes", () => {
  it("GET /card/:cardId returns empty list initially", async () => {
    const res = await req("GET", `/card/${cardId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("GET /:executionId returns 404 for non-existent", async () => {
    const res = await req("GET", "/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("GET /card/:cardId returns executions after creation", async () => {
    executionsDb.createExecution(db, cardId as any, null, "plan");

    const res = await req("GET", `/card/${cardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].card_id).toBe(cardId);
  });

  it("GET /:executionId returns specific execution", async () => {
    const exec = executionsDb.createExecution(db, cardId as any, null, "execute");

    const res = await req("GET", `/${exec.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(exec.id);
    expect(body.phase).toBe("execute");
  });
});
