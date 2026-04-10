import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { caffeinateRoutes } from "../routes/caffeinate.js";
import {
  isCaffeinateActive,
  isSleepPreventionSupported,
  stopCaffeinate,
} from "../caffeinate.js";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import type { BoardId } from "@glue-paste-dev/core";

let app: Hono;
let db: Database;

beforeEach(() => {
  stopCaffeinate();
  db = getTestDb();
  app = new Hono();
  app.route("/api/caffeinate", caffeinateRoutes(db));
});

afterEach(() => {
  stopCaffeinate();
});

describe("caffeinate routes", () => {
  it("GET /api/caffeinate returns active status", async () => {
    const res = await app.request("/api/caffeinate");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ active: false, activeBoards: [] });
  });

  it("GET /api/caffeinate returns activeBoards when queued cards exist", async () => {
    const board = boardsDb.createBoard(db, {
      name: "Active Board",
      description: "",
      directory: "/tmp/test-route-board",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Task",
      description: "",
    });
    cardsDb.updateCardStatus(db, card.id as any, "queued");

    const res = await app.request("/api/caffeinate");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeBoards).toHaveLength(1);
    expect(body.activeBoards[0]).toMatchObject({ id: board.id, name: "Active Board" });
  });

  it("GET /api/caffeinate returns empty activeBoards when only done cards", async () => {
    const board = boardsDb.createBoard(db, {
      name: "Done Board",
      description: "",
      directory: "/tmp/test-route-board-done",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Done Task",
      description: "",
    });
    cardsDb.updateCardStatus(db, card.id as any, "done");

    const res = await app.request("/api/caffeinate");
    const body = await res.json();
    expect(body.activeBoards).toHaveLength(0);
  });

  it("POST /api/caffeinate starts caffeinate", async () => {
    const res = await app.request("/api/caffeinate", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    if (isSleepPreventionSupported()) {
      expect(body.active).toBe(true);
    } else {
      expect(body.active).toBe(false);
    }
  });

  it("DELETE /api/caffeinate stops caffeinate", async () => {
    await app.request("/api/caffeinate", { method: "POST" });

    const res = await app.request("/api/caffeinate", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
    expect(isCaffeinateActive()).toBe(false);
  });

  it("GET reflects current state after POST and DELETE", async () => {
    let res = await app.request("/api/caffeinate");
    let body = await res.json();
    expect(body.active).toBe(false);

    await app.request("/api/caffeinate", { method: "POST" });
    res = await app.request("/api/caffeinate");
    body = await res.json();
    expect(body.active).toBe(isSleepPreventionSupported());

    await app.request("/api/caffeinate", { method: "DELETE" });
    res = await app.request("/api/caffeinate");
    body = await res.json();
    expect(body.active).toBe(false);
  });
});
