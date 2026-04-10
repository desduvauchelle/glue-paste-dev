import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import type { BoardId, CardId } from "@glue-paste-dev/core";
import { cardRoutes } from "../routes/cards.js";
import {
  isCaffeinateActive,
  isSleepPreventionSupported,
  startCaffeinate,
  stopCaffeinate,
} from "../caffeinate.js";

let db: Database;

beforeEach(() => {
  db = getTestDb();
  stopCaffeinate();
});

afterEach(() => {
  stopCaffeinate();
});

describe("caffeinate on manual card moves", () => {
  it("turns caffeinate OFF when last active card is moved to done", async () => {
    if (!isSleepPreventionSupported()) return;

    const board = boardsDb.createBoard(db, {
      name: "Board",
      description: "",
      directory: "/tmp/caff-move-1",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card",
      description: "",
    });
    cardsDb.updateCardStatus(db, card.id as CardId, "queued");
    startCaffeinate();
    expect(isCaffeinateActive()).toBe(true);

    const broadcasts: unknown[] = [];
    const app = new Hono();
    app.route("/", cardRoutes(db, (e) => broadcasts.push(e)));

    const res = await app.request(`/${card.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", position: 0 }),
    });
    expect(res.status).toBe(200);
    expect(isCaffeinateActive()).toBe(false);
  });

  it("turns caffeinate ON when card is moved to queued", async () => {
    if (!isSleepPreventionSupported()) return;

    const board = boardsDb.createBoard(db, {
      name: "Board",
      description: "",
      directory: "/tmp/caff-move-2",
    });
    // Use a human-assigned card so queue auto-execution is skipped
    // (countActiveCards still counts it, so caffeinate turns on)
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card",
      description: "",
      assignee: "human",
    });
    // Card starts as todo — caffeinate should be off
    expect(isCaffeinateActive()).toBe(false);

    const broadcasts: unknown[] = [];
    const app = new Hono();
    app.route("/", cardRoutes(db, (e) => broadcasts.push(e)));

    const res = await app.request(`/${card.id}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "queued", position: 0 }),
    });
    expect(res.status).toBe(200);
    expect(isCaffeinateActive()).toBe(true);
  });

  it("turns caffeinate OFF when active card is deleted", async () => {
    if (!isSleepPreventionSupported()) return;

    const board = boardsDb.createBoard(db, {
      name: "Board",
      description: "",
      directory: "/tmp/caff-move-3",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card",
      description: "",
    });
    cardsDb.updateCardStatus(db, card.id as CardId, "in-progress");
    startCaffeinate();
    expect(isCaffeinateActive()).toBe(true);

    const broadcasts: unknown[] = [];
    const app = new Hono();
    app.route("/", cardRoutes(db, (e) => broadcasts.push(e)));

    const res = await app.request(`/${card.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(isCaffeinateActive()).toBe(false);
  });
});
