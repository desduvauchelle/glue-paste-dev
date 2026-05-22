import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";

const mockOpen = mock(() => {});
const mockIsRunning = mock(() => false);
const mockGetScrollback = mock(() => "");
const mockClose = mock(() => {});

mock.module("../../terminal-hub-singleton.js", () => ({
  getTerminalHub: () => ({
    open: mockOpen,
    isRunning: mockIsRunning,
    getScrollback: mockGetScrollback,
    close: mockClose,
  }),
}));

import { terminalRoutes } from "../../routes/terminal.js";

let app: Hono;
let db: Database;
let cardId: string;

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test Board",
    description: "",
    directory: "/tmp/test",
  });
  const card = cardsDb.createCard(db, board.id as any, {
    title: "Test Card",
    description: "desc",
    tags: [],
  });
  cardId = card.id;
  app = new Hono();
  app.route("/api/cards", terminalRoutes(db, () => {}));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/cards${path}`, init);
}

describe("POST /:id/terminal", () => {
  it("returns 404 for non-existent card", async () => {
    const res = await req("POST", "/nonexistent/terminal", { cols: 80, rows: 24 });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Card not found");
  });
});

describe("GET /:id/terminal", () => {
  it("returns running:false and empty scrollback for card with no open session", async () => {
    const res = await req("GET", `/${cardId}/terminal`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(false);
    expect(body.scrollback).toBe("");
  });
});

describe("DELETE /:id/terminal", () => {
  it("returns ok:true for card with no session", async () => {
    const res = await req("DELETE", `/${cardId}/terminal`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
