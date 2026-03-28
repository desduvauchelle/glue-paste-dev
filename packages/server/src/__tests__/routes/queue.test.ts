import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { boardsDb, cardsDb, getTestDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import type { BoardId, CardId } from "@glue-paste-dev/core";
import { queueRoutes, cardExecuteRoutes } from "../../routes/queue.js";

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
  app.route("/api/queue", queueRoutes(db, (event) => broadcasts.push(event)));
  app.route("/api/cards", cardExecuteRoutes(db, (event) => broadcasts.push(event)));
});

function req(method: string, path: string) {
  return app.request(`http://localhost/api/queue${path}`, { method });
}

function cardReq(method: string, path: string) {
  return app.request(`http://localhost/api/cards${path}`, { method });
}

describe("queue routes", () => {
  it("GET /:boardId returns default state for new board", async () => {
    const res = await req("GET", `/${boardId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.isRunning).toBe(false);
    expect(body.queue).toEqual([]);
    expect(body.current).toBeNull();
  });

  it("POST /:boardId/play with no queued cards broadcasts queue:stopped", async () => {
    const res = await req("POST", `/${boardId}/play`);
    expect(res.status).toBe(200);
    // Wait for async startQueue to complete
    await new Promise((r) => setTimeout(r, 200));
    const stopEvent = broadcasts.find(
      (b: unknown) => (b as Record<string, unknown>).type === "queue:stopped"
    );
    expect(stopEvent).toBeDefined();
  });

  it("DELETE /:boardId/play stops a running queue", async () => {
    cardsDb.createCard(db, boardId as BoardId, {
      title: "Card",
      description: "",
      tags: [],
      status: "queued",
    });
    await req("POST", `/${boardId}/play`);

    const res = await req("DELETE", `/${boardId}/play`);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 200));
    const stopEvent = broadcasts.find(
      (b: unknown) => (b as Record<string, unknown>).type === "queue:stopped"
    );
    expect(stopEvent).toBeDefined();
  });

  it("POST /:boardId/pause pauses a running queue", async () => {
    cardsDb.createCard(db, boardId as BoardId, {
      title: "Card",
      description: "",
      tags: [],
      status: "queued",
    });
    await req("POST", `/${boardId}/play`);
    await new Promise((r) => setTimeout(r, 50));

    const res = await req("POST", `/${boardId}/pause`);
    expect(res.status).toBe(200);

    // Clean up
    await req("DELETE", `/${boardId}/play`);
    await new Promise((r) => setTimeout(r, 200));
  });

  it("POST /:boardId/resume returns 200", async () => {
    const res = await req("POST", `/${boardId}/resume`);
    expect(res.status).toBe(200);
  });
});

describe("card execute routes", () => {
  it("POST /:cardId/execute starts execution for queued card", async () => {
    const card = cardsDb.createCard(db, boardId as BoardId, {
      title: "Exec Card",
      description: "",
      tags: [],
      status: "queued",
    });

    const res = await cardReq("POST", `/${card.id}/execute`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // Clean up - wait for execution attempt to complete/fail
    await new Promise((r) => setTimeout(r, 200));
  });

  it("POST /:cardId/execute returns 400 for human-assigned card", async () => {
    const card = cardsDb.createCard(db, boardId as BoardId, {
      title: "Human Card",
      description: "",
      tags: [],
      status: "queued",
      assignee: "human",
    });

    const res = await cardReq("POST", `/${card.id}/execute`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toContain("Human");

    // Card status should remain queued
    const updated = cardsDb.getCard(db, card.id as CardId);
    expect(updated!.status).toBe("queued");
  });

  it("POST /:cardId/stop returns 200", async () => {
    const card = cardsDb.createCard(db, boardId as BoardId, {
      title: "Stop Card",
      description: "",
      tags: [],
      status: "queued",
    });

    const res = await cardReq("POST", `/${card.id}/stop`);
    expect(res.status).toBe(200);
  });
});
