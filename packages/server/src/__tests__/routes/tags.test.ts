import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { tagRoutes } from "../../routes/tags.js";

let app: Hono;
let db: Database;
let boardId: string;

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id;

  app = new Hono();
  app.route("/api/tags", tagRoutes(db));
});

function req(path: string) {
  return app.request(`http://localhost/api/tags${path}`, { method: "GET" });
}

describe("tag routes", () => {
  it("GET /defaults returns default tags", async () => {
    const res = await req("/defaults");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("UX");
    expect(body).toContain("backend");
  });

  it("GET /board/:boardId returns distinct tags (empty initially)", async () => {
    const res = await req(`/board/${boardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /board/:boardId returns tags from cards", async () => {
    cardsDb.createCard(db, boardId as any, {
      title: "Card",
      tags: ["API", "UX"],
    });

    const res = await req(`/board/${boardId}`);
    const body = await res.json();
    expect(body).toContain("API");
    expect(body).toContain("UX");
  });
});
