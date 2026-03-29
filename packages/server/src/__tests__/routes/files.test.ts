import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { getTestDb, boardsDb } from "@glue-paste-dev/core";
import type { Database } from "bun:sqlite";
import { fileRoutes } from "../../routes/files.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

let app: Hono;
let db: Database;
let boardId: string;
const TEST_DIR = `/tmp/glue-paste-test-files-${process.pid}-${Date.now()}`;

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });
  mkdirSync(join(TEST_DIR, "node_modules"), { recursive: true });
  writeFileSync(join(TEST_DIR, "src", "index.ts"), "export {}");
  writeFileSync(join(TEST_DIR, "README.md"), "# Test");
  writeFileSync(join(TEST_DIR, "node_modules", "pkg.js"), "module");

  db = getTestDb();
  const board = boardsDb.createBoard(db, { name: "Test Board", description: "", directory: TEST_DIR });
  boardId = board.id;
  app = new Hono();
  app.route("/api/files", fileRoutes(db));
});

function req(method: string, path: string) {
  return app.request(`http://localhost/api/files${path}`, { method });
}

describe("GET /board/:boardId", () => {
  it("returns 404 for non-existent board", async () => {
    const res = await req("GET", "/board/nonexistent");
    expect(res.status).toBe(404);
  });

  it("lists files and directories, excluding IGNORED entries", async () => {
    const res = await req("GET", `/board/${boardId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.map((e: any) => e.name);
    expect(names).toContain("src");
    expect(names).toContain("README.md");
    expect(names).not.toContain("node_modules");
  });

  it("sorts directories before files", async () => {
    const res = await req("GET", `/board/${boardId}`);
    const body = await res.json();
    const types = body.map((e: any) => e.type);
    const firstFileIdx = types.indexOf("file");
    const lastDirIdx = types.lastIndexOf("directory");
    if (firstFileIdx >= 0 && lastDirIdx >= 0) {
      expect(lastDirIdx).toBeLessThan(firstFileIdx);
    }
  });

  it("blocks directory traversal with ../", async () => {
    const res = await req("GET", `/board/${boardId}?path=../../etc`);
    expect(res.status).toBe(400);
  });
});

describe("GET /board/:boardId/tree", () => {
  it("returns recursive file tree", async () => {
    const res = await req("GET", `/board/${boardId}/tree`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(false);
    const paths = body.entries.map((e: any) => e.path);
    expect(paths).toContain("src");
    expect(paths).toContain(join("src", "index.ts"));
  });
});
