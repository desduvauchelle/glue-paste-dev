import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { boardRoutes } from "../../routes/boards.js";

let app: Hono;
let db: Database;
const broadcasts: unknown[] = [];

beforeEach(() => {
  db = getTestDb();

  broadcasts.length = 0;
  app = new Hono();
  app.route("/api/boards", boardRoutes(db, (event) => broadcasts.push(event)));
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  const url = path === "/" ? "/api/boards" : `/api/boards${path}`;
  return app.request(url, init);
}

describe("board routes", () => {
  it("GET / returns empty list initially", async () => {
    const res = await req("GET", "/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST / creates a board", async () => {
    const res = await req("POST", "/", {
      name: "Test Board",
      description: "A test",
      directory: "/tmp/test",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Test Board");
    expect(body.id).toBeDefined();
  });

  it("POST / returns 400 for invalid data", async () => {
    const res = await req("POST", "/", { description: "missing name and directory" });
    expect(res.status).toBe(400);
  });

  it("GET /:boardId returns a specific board", async () => {
    const createRes = await req("POST", "/", {
      name: "Board",
      description: "",
      directory: "/tmp",
    });
    const board = await createRes.json();

    const res = await req("GET", `/${board.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(board.id);
    expect(body.name).toBe("Board");
  });

  it("GET /:boardId returns 404 for missing board", async () => {
    const res = await req("GET", "/nonexistent");
    expect(res.status).toBe(404);
  });

  it("PUT /:boardId updates a board", async () => {
    const createRes = await req("POST", "/", {
      name: "Original",
      description: "",
      directory: "/tmp",
    });
    const board = await createRes.json();

    const res = await req("PUT", `/${board.id}`, { name: "Updated" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated");
  });

  it("PUT /:boardId returns 404 for missing board", async () => {
    const res = await req("PUT", "/nonexistent", { name: "Updated" });
    expect(res.status).toBe(404);
  });

  it("DELETE /:boardId deletes a board", async () => {
    const createRes = await req("POST", "/", {
      name: "ToDelete",
      description: "",
      directory: "/tmp",
    });
    const board = await createRes.json();

    const res = await req("DELETE", `/${board.id}`);
    expect(res.status).toBe(200);

    const getRes = await req("GET", `/${board.id}`);
    expect(getRes.status).toBe(404);
  });

  it("DELETE /:boardId returns 404 for missing board", async () => {
    const res = await req("DELETE", "/nonexistent");
    expect(res.status).toBe(404);
  });

  it("POST / accepts a slug on board creation", async () => {
    const res = await req("POST", "/", {
      name: "Slugged Board",
      description: "",
      directory: "/tmp/slugged",
      slug: "my-project",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe("my-project");
  });

  it("POST / rejects invalid slug characters", async () => {
    const res = await req("POST", "/", {
      name: "Bad Slug Board",
      description: "",
      directory: "/tmp/bad",
      slug: "Hello World!",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /:boardId updates the slug", async () => {
    const createRes = await req("POST", "/", {
      name: "Board",
      description: "",
      directory: "/tmp/s",
    });
    const board = await createRes.json();

    const res = await req("PUT", `/${board.id}`, { slug: "new-slug" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe("new-slug");
  });

  it("PUT /:boardId clears slug when null is passed", async () => {
    const createRes = await req("POST", "/", {
      name: "Board",
      description: "",
      directory: "/tmp/s2",
      slug: "clear-me",
    });
    const board = await createRes.json();

    const res = await req("PUT", `/${board.id}`, { slug: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBeNull();
  });
});
