import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { caffeinateRoutes } from "../routes/caffeinate.js";
import {
  isCaffeinateActive,
  isSleepPreventionSupported,
  stopCaffeinate,
} from "../caffeinate.js";

let app: Hono;

beforeEach(() => {
  stopCaffeinate();
  app = new Hono();
  app.route("/api/caffeinate", caffeinateRoutes());
});

afterEach(() => {
  stopCaffeinate();
});

describe("caffeinate routes", () => {
  it("GET /api/caffeinate returns active status", async () => {
    const res = await app.request("/api/caffeinate");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ active: false });
  });

  it("POST /api/caffeinate starts caffeinate", async () => {
    const res = await app.request("/api/caffeinate", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    if (isSleepPreventionSupported()) {
      expect(body.active).toBe(true);
    } else {
      expect(body.active).toBe(false);
    }
  });

  it("DELETE /api/caffeinate stops caffeinate", async () => {
    await app.request("/api/caffeinate", { method: "POST" });

    const res = await app.request("/api/caffeinate", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
    expect(isCaffeinateActive()).toBe(false);
  });

  it("GET reflects current state after POST and DELETE", async () => {
    let res = await app.request("/api/caffeinate");
    let body = await res.json();
    expect(body.active).toBe(false);

    await app.request("/api/caffeinate", { method: "POST" });
    res = await app.request("/api/caffeinate");
    body = await res.json();
    expect(body.active).toBe(isSleepPreventionSupported());

    await app.request("/api/caffeinate", { method: "DELETE" });
    res = await app.request("/api/caffeinate");
    body = await res.json();
    expect(body.active).toBe(false);
  });
});
