import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Hono } from "hono";

mock.module("@glue-paste-dev/core", () => ({
  generateTitle: async (desc: string) => `Title for: ${desc.slice(0, 20)}`,
}));

import { aiRoutes } from "../../routes/ai.js";

let app: Hono;

beforeEach(() => {
  app = new Hono();
  app.route("/api/ai", aiRoutes());
});

function post(path: string, body: object) {
  return app.request(`http://localhost/api/ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ai/generate-title", () => {
  it("returns generated title for valid description", async () => {
    const res = await post("/generate-title", { description: "Fix the login page" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string };
    expect(json.title).toBeDefined();
    expect(typeof json.title).toBe("string");
    expect(json.title.length).toBeGreaterThan(0);
  });

  it("returns empty title for empty description", async () => {
    const res = await post("/generate-title", { description: "" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string };
    expect(json.title).toBe("");
  });

  it("returns empty title for missing description", async () => {
    const res = await post("/generate-title", {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string };
    expect(json.title).toBe("");
  });

  it("returns empty title for whitespace-only description", async () => {
    const res = await post("/generate-title", { description: "   " });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { title: string };
    expect(json.title).toBe("");
  });
});
