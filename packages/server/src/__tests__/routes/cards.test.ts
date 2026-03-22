import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { cardRoutes } from "../../routes/cards.js";

let app: Hono;
let db: Database;
let boardId: string;
const broadcasts: unknown[] = [];

beforeEach(() => {
  db = getTestDb();

  const board = boardsDb.createBoard(db, {
    name: "Test Board",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id;

  broadcasts.length = 0;
  app = new Hono();
  app.route("/api/cards", cardRoutes(db, (event) => broadcasts.push(event)));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/cards${path}`, init);
}

describe("card routes", () => {
  it("GET /board/:boardId returns empty list initially", async () => {
    const res = await req("GET", `/board/${boardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /board/:boardId creates a card and broadcasts", async () => {
    const res = await req("POST", `/board/${boardId}`, {
      title: "New Card",
      description: "Desc",
      tags: ["UX"],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("New Card");
    expect(body.tags).toEqual(["UX"]);
    expect(body.status).toBe("todo");

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("card:created");
  });

  it("POST /board/:boardId returns 400 for invalid data", async () => {
    const res = await req("POST", `/board/${boardId}`, {
      status: "invalid-status",
    });
    expect(res.status).toBe(400);
  });

  it("GET /:cardId returns a card", async () => {
    const createRes = await req("POST", `/board/${boardId}`, {
      title: "Card",
      description: "",
      tags: [],
    });
    const card = await createRes.json();

    const res = await req("GET", `/${card.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Card");
  });

  it("GET /:cardId returns 404 for missing card", async () => {
    const res = await req("GET", "/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PUT /:cardId updates a card and broadcasts", async () => {
    const createRes = await req("POST", `/board/${boardId}`, {
      title: "Original",
      description: "",
      tags: [],
    });
    const card = await createRes.json();
    broadcasts.length = 0;

    const res = await req("PUT", `/${card.id}`, {
      title: "Updated",
      tags: ["backend"],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Updated");
    expect(body.tags).toEqual(["backend"]);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("card:updated");
  });

  it("PUT /:cardId returns 404 for missing card", async () => {
    const res = await req("PUT", "/nonexistent", { title: "Updated" });
    expect(res.status).toBe(404);
  });

  it("PATCH /:cardId/move moves a card", async () => {
    const createRes = await req("POST", `/board/${boardId}`, {
      title: "Movable",
      description: "",
      tags: [],
    });
    const card = await createRes.json();
    broadcasts.length = 0;

    const res = await req("PATCH", `/${card.id}/move`, {
      status: "in-progress",
      position: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("in-progress");

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("card:updated");
  });

  it("PATCH /reorder updates positions for multiple cards", async () => {
    const c1 = await (await req("POST", `/board/${boardId}`, { title: "C1", description: "", tags: [] })).json();
    const c2 = await (await req("POST", `/board/${boardId}`, { title: "C2", description: "", tags: [] })).json();
    broadcasts.length = 0;

    const res = await req("PATCH", "/reorder", [
      { id: c1.id, status: "queued", position: 1 },
      { id: c2.id, status: "queued", position: 0 },
    ]);
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("cards:reordered");
  });

  it("DELETE /:cardId deletes a card and broadcasts", async () => {
    const createRes = await req("POST", `/board/${boardId}`, {
      title: "ToDelete",
      description: "",
      tags: [],
    });
    const card = await createRes.json();
    broadcasts.length = 0;

    const res = await req("DELETE", `/${card.id}`);
    expect(res.status).toBe(200);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("card:deleted");

    const getRes = await req("GET", `/${card.id}`);
    expect(getRes.status).toBe(404);
  });

  it("DELETE /:cardId returns 404 for missing card", async () => {
    const res = await req("DELETE", "/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PATCH /:cardId/move-to-board moves card between boards", async () => {
    const board2 = boardsDb.createBoard(db, {
      name: "Board 2",
      description: "",
      directory: "/tmp/test2",
    });

    const createRes = await req("POST", `/board/${boardId}`, {
      title: "Cross-board",
      description: "",
      tags: [],
    });
    const card = await createRes.json();
    broadcasts.length = 0;

    const res = await req("PATCH", `/${card.id}/move-to-board`, {
      board_id: board2.id,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.board_id).toBe(board2.id);
    expect(body.status).toBe("todo");

    // Should broadcast delete from old board and create on new board
    expect(broadcasts).toHaveLength(2);
    expect((broadcasts[0] as any).type).toBe("card:deleted");
    expect((broadcasts[1] as any).type).toBe("card:created");
  });
});
