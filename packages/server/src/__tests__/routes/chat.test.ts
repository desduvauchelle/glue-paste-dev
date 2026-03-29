import { describe, it, expect, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";

const mockRunChat = mock(() => Promise.resolve(undefined));
const mockKillChatProcess = mock(() => true);
const mockHasChatProcess = mock(() => false);

mock.module("@glue-paste-dev/core", () => {
  const actual = require("@glue-paste-dev/core");
  return {
    ...actual,
    runChat: mockRunChat,
    killChatProcess: mockKillChatProcess,
    hasChatProcess: mockHasChatProcess,
  };
});

import { chatRoutes } from "../../routes/chat.js";

let app: Hono;
let db: Database;
let cardId: string;
const broadcasts: unknown[] = [];

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, { name: "Test Board", description: "", directory: "/tmp/test" });
  const card = cardsDb.createCard(db, board.id as any, { title: "Test Card", description: "desc", tags: [] });
  cardId = card.id;
  broadcasts.length = 0;
  app = new Hono();
  app.route("/api/cards", chatRoutes(db, (e) => broadcasts.push(e)));
  mockHasChatProcess.mockImplementation(() => false);
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/cards${path}`, init);
}

describe("POST /:cardId/chat", () => {
  it("returns 404 for non-existent card", async () => {
    const res = await req("POST", "/nonexistent/chat", { message: "hello", mode: "plan", thinking: "smart" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when message is empty", async () => {
    const res = await req("POST", `/${cardId}/chat`, { message: "", mode: "plan", thinking: "smart" });
    expect(res.status).toBe(400);
  });

  it("returns 409 when chat is already in progress", async () => {
    mockHasChatProcess.mockImplementation(() => true);
    const res = await req("POST", `/${cardId}/chat`, { message: "hello", mode: "plan", thinking: "smart" });
    expect(res.status).toBe(409);
  });

  it("returns 200 with valid request", async () => {
    const res = await req("POST", `/${cardId}/chat`, { message: "hello", mode: "plan", thinking: "smart" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("DELETE /:cardId/chat", () => {
  it("returns ok with killed status", async () => {
    const res = await req("DELETE", `/${cardId}/chat`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
