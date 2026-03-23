import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { getTestDb, cardsDb, boardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import type { BoardId } from "@glue-paste-dev/core";
import {
  startCaffeinate,
  stopCaffeinate,
  isCaffeinateActive,
  checkAndToggleCaffeinate,
  isSleepPreventionSupported,
} from "../caffeinate.js";

let db: Database;

beforeEach(() => {
  db = getTestDb();
  // Always clean up caffeinate state between tests
  stopCaffeinate();
});

afterEach(() => {
  stopCaffeinate();
});

describe("caffeinate", () => {
  describe("startCaffeinate / stopCaffeinate", () => {
    it("starts and reports active", () => {
      startCaffeinate();
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());
    });

    it("is idempotent — calling start twice does not error", () => {
      startCaffeinate();
      startCaffeinate(); // should be a no-op
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());
    });

    it("stops and reports inactive", () => {
      startCaffeinate();
      stopCaffeinate();
      expect(isCaffeinateActive()).toBe(false);
    });

    it("stop is idempotent — calling stop when already stopped does not error", () => {
      stopCaffeinate(); // already stopped
      expect(isCaffeinateActive()).toBe(false);
    });
  });

  describe("checkAndToggleCaffeinate", () => {
    it("starts caffeinate when queued cards exist", () => {
      const boardId = createBoardWithQueuedCard(db);
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());
    });

    it("starts caffeinate when in-progress cards exist", () => {
      const boardId = createBoardWithInProgressCard(db);
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());
    });

    it("stops caffeinate when no active cards", () => {
      // First start it
      startCaffeinate();
      // No cards in DB → should stop
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(false);
    });

    it("stops caffeinate when all cards are done", () => {
      startCaffeinate();
      const boardId = createBoard(db);
      createCard(db, boardId, "done");
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(false);
    });

    it("stops caffeinate when all cards are failed", () => {
      startCaffeinate();
      const boardId = createBoard(db);
      createCard(db, boardId, "failed");
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(false);
    });

    it("keeps caffeinate on when mix of done and queued cards", () => {
      const boardId = createBoard(db);
      createCard(db, boardId, "done");
      createCard(db, boardId, "queued");
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());
    });

    it("transitions from active to inactive when last card completes", () => {
      const boardId = createBoard(db);
      const cardId = createCard(db, boardId, "in-progress");

      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(isSleepPreventionSupported());

      // Simulate card completing
      cardsDb.updateCardStatus(db, cardId as any, "done");
      checkAndToggleCaffeinate(db);
      expect(isCaffeinateActive()).toBe(false);
    });
  });
});

// --- Helpers ---

function createBoard(db: Database): string {
  const board = boardsDb.createBoard(db, {
    name: "Test Board",
    description: "test",
    directory: "/tmp/test-caffeinate",
  });
  return board.id;
}

function createCard(db: Database, boardId: string, status: string): string {
  const card = cardsDb.createCard(db, boardId as BoardId, {
    title: `Card ${status}`,
    description: "test card",
  });
  if (status !== "todo") {
    // createCard defaults to "todo", so update if needed
    if (status === "queued") {
      cardsDb.updateCardStatus(db, card.id as any, "queued");
    } else if (status === "in-progress") {
      cardsDb.updateCardStatus(db, card.id as any, "in-progress");
    } else if (status === "done") {
      cardsDb.updateCardStatus(db, card.id as any, "done");
    } else if (status === "failed") {
      cardsDb.updateCardStatus(db, card.id as any, "failed");
    }
  }
  return card.id;
}

function createBoardWithQueuedCard(db: Database): string {
  const boardId = createBoard(db);
  createCard(db, boardId, "queued");
  return boardId;
}

function createBoardWithInProgressCard(db: Database): string {
  const boardId = createBoard(db);
  createCard(db, boardId, "in-progress");
  return boardId;
}
