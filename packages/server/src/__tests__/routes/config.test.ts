import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { configRoutes } from "../../routes/config.js";

let app: Hono;
let db: Database;
let boardId: string;

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test Board",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id;

  app = new Hono();
  app.route("/api/config", configRoutes(db, () => {}));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  const url = path === "/" ? "/api/config" : `/api/config${path}`;
  return app.request(url, init);
}

describe("config routes", () => {
  it("GET / returns global config with defaults", async () => {
    const res = await req("GET", "/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cliProvider).toBe("claude");
    expect(body.autoCommit).toBe(true);
  });

  it("PUT / updates global config", async () => {
    const res = await req("PUT", "/", { autoCommit: false, maxBudgetUsd: 20 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoCommit).toBe(false);
    expect(body.maxBudgetUsd).toBe(20);
  });

  it("PUT / rejects invalid config", async () => {
    const res = await req("PUT", "/", { cliProvider: "invalid-provider" });
    expect(res.status).toBe(400);
  });

  it("GET /board/:boardId returns merged config", async () => {
    await req("PUT", "/", { autoCommit: false });
    const res = await req("GET", `/board/${boardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.autoCommit).toBe(false);
  });

  it("GET /board/:boardId/raw returns empty object for new board", async () => {
    const res = await req("GET", `/board/${boardId}/raw`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it("PUT /board/:boardId sets board-level override", async () => {
    await req("PUT", `/board/${boardId}`, { cliProvider: "gemini" });

    const rawRes = await req("GET", `/board/${boardId}/raw`);
    const raw = await rawRes.json();
    expect(raw.cliProvider).toBe("gemini");
  });

  it("board config overrides global config", async () => {
    await req("PUT", "/", { cliProvider: "claude" });
    await req("PUT", `/board/${boardId}`, { cliProvider: "gemini" });

    const res = await req("GET", `/board/${boardId}`);
    const body = await res.json();
    expect(body.cliProvider).toBe("gemini");
  });
});
