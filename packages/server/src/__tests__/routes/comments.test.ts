import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { commentRoutes } from "../../routes/comments.js";

let app: Hono;
let db: Database;
let cardId: string;
const broadcasts: unknown[] = [];

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

  broadcasts.length = 0;
  app = new Hono();
  app.route("/api/comments", commentRoutes(db, (event) => broadcasts.push(event)));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/comments${path}`, init);
}

describe("comment routes", () => {
  it("GET /card/:cardId returns empty list initially", async () => {
    const res = await req("GET", `/card/${cardId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /card/:cardId creates comment and broadcasts", async () => {
    const res = await req("POST", `/card/${cardId}`, {
      content: "Hello",
      author: "user",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content).toBe("Hello");
    expect(body.author).toBe("user");
    expect(body.card_id).toBe(cardId);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("comment:added");
  });

  it("POST /card/:cardId rejects empty content", async () => {
    const res = await req("POST", `/card/${cardId}`, { content: "", author: "user" });
    expect(res.status).toBe(400);
  });

  it("DELETE /card/:cardId clears all comments and broadcasts", async () => {
    await req("POST", `/card/${cardId}`, { content: "A", author: "user" });
    await req("POST", `/card/${cardId}`, { content: "B", author: "user" });

    broadcasts.length = 0;
    const res = await req("DELETE", `/card/${cardId}`);
    expect(res.status).toBe(200);

    const listRes = await req("GET", `/card/${cardId}`);
    expect(await listRes.json()).toEqual([]);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("comments:cleared");
  });
});
