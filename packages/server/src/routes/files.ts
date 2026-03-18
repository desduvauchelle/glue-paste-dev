import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { boardsDb } from "@glue-paste-dev/core";
import type { BoardId } from "@glue-paste-dev/core";
import { readdirSync, statSync } from "fs";
import { resolve, join, relative } from "path";

const IGNORED = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  ".DS_Store",
]);

interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

export function fileRoutes(db: Database) {
  const app = new Hono();

  // GET /api/files/board/:boardId?path=<subdir>
  app.get("/board/:boardId", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const subPath = c.req.query("path") || "";
    const rootDir = resolve(board.directory);
    const targetDir = resolve(rootDir, subPath);

    // Prevent directory traversal
    if (!targetDir.startsWith(rootDir)) {
      return c.json({ error: "Invalid path" }, 400);
    }

    try {
      const entries = readdirSync(targetDir);
      const result: FileEntry[] = [];

      for (const name of entries) {
        if (IGNORED.has(name)) continue;

        try {
          const fullPath = join(targetDir, name);
          const stat = statSync(fullPath);
          const relPath = relative(rootDir, fullPath);
          result.push({
            name,
            type: stat.isDirectory() ? "directory" : "file",
            path: relPath,
          });
        } catch {
          // Skip entries we can't stat
        }
      }

      // Sort: directories first, then alphabetically
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return c.json(result);
    } catch {
      return c.json({ error: "Cannot read directory" }, 400);
    }
  });

  // GET /api/files/board/:boardId/tree — recursive file tree for fuzzy search
  app.get("/board/:boardId/tree", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const rootDir = resolve(board.directory);
    const maxFiles = 10000;
    const maxDepth = 20;
    const entries: FileEntry[] = [];
    let truncated = false;

    function walk(dir: string, depth: number) {
      if (depth > maxDepth || truncated) return;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (IGNORED.has(name)) continue;
        if (entries.length >= maxFiles) {
          truncated = true;
          return;
        }
        try {
          const fullPath = join(dir, name);
          const stat = statSync(fullPath);
          const relPath = relative(rootDir, fullPath);
          const isDir = stat.isDirectory();
          entries.push({ name, type: isDir ? "directory" : "file", path: relPath });
          if (isDir) walk(fullPath, depth + 1);
        } catch {
          // skip unreadable
        }
      }
    }

    walk(rootDir, 0);
    return c.json({ entries, truncated });
  });

  return app;
}
