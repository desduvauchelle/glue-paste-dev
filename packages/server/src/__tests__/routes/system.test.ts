import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { systemRoutes } from "../../routes/system.js";

let app: Hono;

beforeEach(() => {
  app = new Hono();
  app.route("/api/system", systemRoutes());
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/system${path}`, init);
}

describe("POST /open-folder", () => {
  it("returns 400 when path is missing", async () => {
    const res = await req("POST", "/open-folder", {});
    expect(res.status).toBe(400);
  });

  it("returns 404 when directory does not exist", async () => {
    const res = await req("POST", "/open-folder", { path: "/nonexistent/path/xyz" });
    expect(res.status).toBe(404);
  });

  it("returns 200 for valid directory", async () => {
    const res = await req("POST", "/open-folder", { path: "/tmp" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
