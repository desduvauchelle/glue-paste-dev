import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { commitRoutes } from "../../routes/commits.js";

let app: Hono;
let db: Database;
let cardId: string;

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, { name: "Test Board", description: "", directory: "/tmp/test" });
  const card = cardsDb.createCard(db, board.id as any, { title: "Test Card", description: "", tags: [] });
  cardId = card.id;
  app = new Hono();
  app.route("/api/commits", commitRoutes(db));
});

function req(method: string, path: string) {
  return app.request(`http://localhost/api/commits${path}`, { method });
}

describe("GET /card/:cardId", () => {
  it("returns empty list when no commits exist", async () => {
    const res = await req("GET", `/card/${cardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
