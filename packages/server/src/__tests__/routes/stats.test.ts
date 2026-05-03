import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { statsRoutes } from "../../routes/stats.js";

let app: Hono;
let db: Database;

beforeEach(() => {
  db = getTestDb();
  app = new Hono();
  app.route("/api/stats", statsRoutes(db));
});

function req(path: string) {
  return app.request(`http://localhost/api/stats${path}`, { method: "GET" });
}

describe("stats routes", () => {
  it("GET /boards returns counts", async () => {
    const res = await req("/boards");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it("GET /done-per-day returns array", async () => {
    const res = await req("/done-per-day");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /done-per-day accepts days param", async () => {
    const res = await req("/done-per-day?days=7");
    expect(res.status).toBe(200);
  });

  it("GET /done-per-day caps at 90 days", async () => {
    const res = await req("/done-per-day?days=200");
    expect(res.status).toBe(200);
  });

  it("GET /done-per-day-by-board returns object", async () => {
    const res = await req("/done-per-day-by-board");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });

  it("GET /done-per-day accepts tzOffset param", async () => {
    const res = await req("/done-per-day?tzOffset=420");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(14);
  });

  it("GET /done-per-day-by-board accepts tzOffset param", async () => {
    const res = await req("/done-per-day-by-board?tzOffset=420");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });
});
