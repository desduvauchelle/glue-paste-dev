import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import type { BoardId, CardId } from "@glue-paste-dev/core";
import { makeCallbacks } from "../callbacks.js";
import {
  isCaffeinateActive,
  isSleepPreventionSupported,
  startCaffeinate,
  stopCaffeinate,
} from "../caffeinate.js";

let db: Database;
let broadcasts: unknown[];

beforeEach(() => {
  db = getTestDb();
  broadcasts = [];
  stopCaffeinate();
});

afterEach(() => {
  stopCaffeinate();
});

describe("callbacks caffeinate integration", () => {
  it("onCardUpdated turns off caffeinate when card moves to done and no active cards remain", () => {
    // Start caffeinate manually
    startCaffeinate();
    if (!isSleepPreventionSupported()) return;

    expect(isCaffeinateActive()).toBe(true);

    const board = boardsDb.createBoard(db, {
      name: "Test",
      description: "",
      directory: "/tmp/test-cb",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Test Card",
      description: "",
    });
    // Card is "todo" — no active cards
    const callbacks = makeCallbacks(db, (e) => broadcasts.push(e));

    // Simulate a card update to "done"
    const updatedCard = { ...card, status: "done" as const };
    callbacks.onCardUpdated(updatedCard);

    expect(isCaffeinateActive()).toBe(false);
  });

  it("onCardUpdated keeps caffeinate on when other queued cards exist", () => {
    if (!isSleepPreventionSupported()) return;

    const board = boardsDb.createBoard(db, {
      name: "Test",
      description: "",
      directory: "/tmp/test-cb2",
    });
    // Create two cards — one queued, one that will be "done"
    const card1 = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card 1",
      description: "",
    });
    cardsDb.updateCardStatus(db, card1.id as CardId, "queued");
    const card2 = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card 2",
      description: "",
    });

    const callbacks = makeCallbacks(db, (e) => broadcasts.push(e));

    // Simulate card2 completing — card1 is still queued
    callbacks.onCardUpdated({ ...card2, status: "done" as const });

    expect(isCaffeinateActive()).toBe(true);
  });

  it("onQueueStopped turns off caffeinate when no active cards", () => {
    startCaffeinate();
    if (!isSleepPreventionSupported()) return;

    expect(isCaffeinateActive()).toBe(true);

    const board = boardsDb.createBoard(db, {
      name: "Test",
      description: "",
      directory: "/tmp/test-cb3",
    });

    const callbacks = makeCallbacks(db, (e) => broadcasts.push(e));
    callbacks.onQueueStopped(board.id, "All cards completed");

    expect(isCaffeinateActive()).toBe(false);
  });

  it("onExecutionStarted triggers caffeinate check", () => {
    if (!isSleepPreventionSupported()) return;

    const board = boardsDb.createBoard(db, {
      name: "Test",
      description: "",
      directory: "/tmp/test-cb-exec",
    });
    const card = cardsDb.createCard(db, board.id as BoardId, {
      title: "Card",
      description: "",
    });
    cardsDb.updateCardStatus(db, card.id as CardId, "in-progress");

    const callbacks = makeCallbacks(db, (e) => broadcasts.push(e));
    callbacks.onExecutionStarted(card.id, "exec-1", "plan");

    expect(isCaffeinateActive()).toBe(true);
  });

  it("onQueueStopped still broadcasts the queue:stopped event", () => {
    const board = boardsDb.createBoard(db, {
      name: "Test",
      description: "",
      directory: "/tmp/test-cb4",
    });

    const callbacks = makeCallbacks(db, (e) => broadcasts.push(e));
    callbacks.onQueueStopped(board.id, "All cards completed");

    const queueStoppedEvent = broadcasts.find(
      (e: any) => e.type === "queue:stopped"
    );
    expect(queueStoppedEvent).toBeTruthy();
  });
});
