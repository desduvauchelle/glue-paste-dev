import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb, cardsDb, criteriaDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { criteriaRoutes } from "../../routes/criteria.js";

let app: Hono;
let db: Database;
let cardId: string;
const events: any[] = [];

beforeEach(() => {
  db = getTestDb();
  const board = boardsDb.createBoard(db, {
    name: "Test",
    description: "",
    directory: "/tmp/test",
  });
  const card = cardsDb.createCard(db, board.id as any, {
    title: "Test Card",
    tags: [],
  });
  cardId = card.id;

  events.length = 0;
  app = new Hono();
  app.route("/api/criteria", criteriaRoutes(db, (e) => events.push(e)));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/criteria${path}`, init);
}

describe("criteria routes", () => {
  it("POST /card/:cardId creates criterion with source user and broadcasts card:updated", async () => {
    const res = await req("POST", `/card/${cardId}`, { text: "must build" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.text).toBe("must build");
    expect(body.source).toBe("user");

    expect(events).toHaveLength(1);
    expect((events[0] as any).type).toBe("card:updated");
  });

  it("POST /card/:cardId with empty text returns 400", async () => {
    const res = await req("POST", `/card/${cardId}`, { text: "" });
    expect(res.status).toBe(400);
  });

  it("PUT /:criterionId updates status and broadcasts card:updated", async () => {
    const criterion = criteriaDb.createCriterion(db, cardId as any, "x");
    events.length = 0;

    const res = await req("PUT", `/${criterion.id}`, { status: "pass" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pass");

    expect(events).toHaveLength(1);
    expect((events[0] as any).type).toBe("card:updated");
  });

  it("DELETE /:criterionId deletes criterion and broadcasts card:updated", async () => {
    const criterion = criteriaDb.createCriterion(db, cardId as any, "x");
    events.length = 0;

    const res = await req("DELETE", `/${criterion.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(events).toHaveLength(1);
    expect((events[0] as any).type).toBe("card:updated");
  });
});
