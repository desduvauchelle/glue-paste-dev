import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { authRoutes } from "../../routes/auth.js";

let app: Hono;

beforeEach(() => {
  app = new Hono();
  app.route("/api/auth", authRoutes());
});

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost/api/auth${path}`, init);
}

describe("POST /token", () => {
  it("returns 400 when token is missing", async () => {
    const res = await req("POST", "/token", {});
    expect(res.status).toBe(400);
  });

  it("stores token and returns ok", async () => {
    const res = await req("POST", "/token", { token: "test-oauth-token" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
