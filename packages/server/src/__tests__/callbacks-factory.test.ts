import { describe, it, expect, beforeEach } from "bun:test";
import { getTestDb, boardsDb, cardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { makeCallbacks } from "../callbacks.js";

let db: Database;
let boardId: string;
let cardId: string;
const broadcasts: unknown[] = [];

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test Board",
    description: "",
    directory: "/tmp/test",
  });
  boardId = board.id;

  const card = cardsDb.createCard(db, boardId as any, {
    title: "Test Card",
    tags: [],
  });
  cardId = card.id;

  broadcasts.length = 0;
});

describe("makeCallbacks", () => {
  it("onExecutionStarted broadcasts execution:started", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onExecutionStarted(cardId, "exec-1", "plan");

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("execution:started");
    expect((broadcasts[0] as any).payload.cardId).toBe(cardId);
    expect((broadcasts[0] as any).payload.phase).toBe("plan");
  });

  it("onOutput broadcasts execution:output", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onOutput("exec-1", "hello world");

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("execution:output");
    expect((broadcasts[0] as any).payload.executionId).toBe("exec-1");
    expect((broadcasts[0] as any).payload.chunk).toBe("hello world");
  });

  it("onExecutionCompleted broadcasts execution:completed", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onExecutionCompleted("exec-1", "success", 0);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("execution:completed");
    expect((broadcasts[0] as any).payload.status).toBe("success");
    expect((broadcasts[0] as any).payload.exitCode).toBe(0);
  });

  it("onCommentAdded broadcasts comment:added", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    const comment = { id: "c1", content: "test", author: "user" };
    cbs.onCommentAdded(comment as any);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("comment:added");
    expect((broadcasts[0] as any).payload).toEqual(comment);
  });

  it("onQueueUpdated broadcasts queue:updated with active array", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onQueueUpdated(boardId, [], null, false, ["card-1", "card-2"]);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("queue:updated");
    expect((broadcasts[0] as any).payload.boardId).toBe(boardId);
    expect((broadcasts[0] as any).payload.active).toEqual(["card-1", "card-2"]);
  });

  it("onCardUpdated broadcasts card:updated and notification for done status", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    const card = cardsDb.getCard(db, cardId as any);
    // Simulate a done card
    const doneCard = { ...card, status: "done" };
    cbs.onCardUpdated(doneCard as any);

    const cardEvent = broadcasts.find((b: any) => b.type === "card:updated");
    expect(cardEvent).toBeDefined();

    const notifEvent = broadcasts.find((b: any) => b.type === "notification");
    expect(notifEvent).toBeDefined();
    expect((notifEvent as any).payload.level).toBe("success");
  });

  it("onCardUpdated broadcasts card:updated and error notification for failed status", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    const card = cardsDb.getCard(db, cardId as any);
    const failedCard = { ...card, status: "failed" };
    cbs.onCardUpdated(failedCard as any);

    const notifEvent = broadcasts.find((b: any) => b.type === "notification");
    expect(notifEvent).toBeDefined();
    expect((notifEvent as any).payload.level).toBe("error");
  });

  it("onCardUpdated does not broadcast notification for todo status", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    const card = cardsDb.getCard(db, cardId as any);
    cbs.onCardUpdated(card as any);

    const notifEvent = broadcasts.find((b: any) => b.type === "notification");
    expect(notifEvent).toBeUndefined();
  });

  it("onQueueStopped broadcasts queue:stopped and notification", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onQueueStopped(boardId, "All cards completed");

    const stopEvent = broadcasts.find((b: any) => b.type === "queue:stopped");
    expect(stopEvent).toBeDefined();
    expect((stopEvent as any).payload.reason).toBe("All cards completed");

    const notifEvent = broadcasts.find((b: any) => b.type === "notification");
    expect(notifEvent).toBeDefined();
    expect((notifEvent as any).payload.level).toBe("info");
  });

  it("onQueueStopped broadcasts error notification when reason includes failed", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onQueueStopped(boardId, "Card failed after retries");

    const notifEvent = broadcasts.find((b: any) => b.type === "notification");
    expect(notifEvent).toBeDefined();
    expect((notifEvent as any).payload.level).toBe("error");
  });

  it("onRateLimited broadcasts warning notification", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onRateLimited!(boardId, "My Card", 30);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("notification");
    expect((broadcasts[0] as any).payload.level).toBe("warning");
    expect((broadcasts[0] as any).payload.title).toBe("Rate Limited");
  });

  it("onOverloaded broadcasts warning notification", () => {
    const cbs = makeCallbacks(db, (e) => broadcasts.push(e));
    cbs.onOverloaded!(boardId, "My Card", 60);

    expect(broadcasts).toHaveLength(1);
    expect((broadcasts[0] as any).type).toBe("notification");
    expect((broadcasts[0] as any).payload.level).toBe("warning");
    expect((broadcasts[0] as any).payload.title).toBe("Servers Overloaded");
  });
});
