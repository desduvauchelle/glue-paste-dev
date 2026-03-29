import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { boardsDb } from "@glue-paste-dev/core";
import type { BoardId } from "@glue-paste-dev/core";
import { readdirSync, statSync, mkdirSync, rmSync } from "fs";
import { resolve, join, relative, basename } from "path";

const IGNORED = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  ".DS_Store",
  ".glue-paste",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function sanitizeFilename(name: string): string {
  return basename(name).replace(/[/\\]/g, "_").replace(/\0/g, "_");
}

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

  // POST /api/files/board/:boardId/upload/:cardId
  app.post("/board/:boardId/upload/:cardId", async (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const cardId = c.req.param("cardId");
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const rootDir = resolve(board.directory);
    const attachmentsDir = join(rootDir, ".glue-paste", "attachments", cardId);
    mkdirSync(attachmentsDir, { recursive: true });

    const body = await c.req.parseBody({ all: true });
    const rawFiles = body["files"];
    const files: File[] = Array.isArray(rawFiles)
      ? (rawFiles.filter((f) => f instanceof File) as File[])
      : rawFiles instanceof File
        ? [rawFiles]
        : [];

    if (files.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    const savedPaths: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: `File "${file.name}" exceeds 10MB limit` }, 400);
      }
      const safeName = sanitizeFilename(file.name) || "upload";
      const destPath = join(attachmentsDir, safeName);
      const buffer = await file.arrayBuffer();
      await Bun.write(destPath, buffer);
      savedPaths.push(relative(rootDir, destPath));
    }

    return c.json(savedPaths);
  });

  // GET /api/files/board/:boardId/attachments/:cardId
  app.get("/board/:boardId/attachments/:cardId", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const cardId = c.req.param("cardId");
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const rootDir = resolve(board.directory);
    const attachmentsDir = join(rootDir, ".glue-paste", "attachments", cardId);

    try {
      const names = readdirSync(attachmentsDir);
      const files = names.map((name) => relative(rootDir, join(attachmentsDir, name)));
      return c.json(files);
    } catch {
      return c.json([]);
    }
  });

  // DELETE /api/files/board/:boardId/attachments/:cardId/:filename
  app.delete("/board/:boardId/attachments/:cardId/:filename", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const cardId = c.req.param("cardId");
    const filename = c.req.param("filename");
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const safeName = sanitizeFilename(filename);
    if (!safeName) {
      return c.json({ error: "Invalid filename" }, 400);
    }

    const rootDir = resolve(board.directory);
    const filePath = join(rootDir, ".glue-paste", "attachments", cardId, safeName);

    try {
      rmSync(filePath);
    } catch {
      // file may not exist
    }

    return c.json({ ok: true });
  });

  // DELETE /api/files/board/:boardId/attachments/:cardId
  app.delete("/board/:boardId/attachments/:cardId", (c) => {
    const boardId = c.req.param("boardId") as BoardId;
    const cardId = c.req.param("cardId");
    const board = boardsDb.getBoard(db, boardId);
    if (!board) {
      return c.json({ error: "Board not found" }, 404);
    }

    const rootDir = resolve(board.directory);
    const attachmentsDir = join(rootDir, ".glue-paste", "attachments", cardId);

    try {
      rmSync(attachmentsDir, { recursive: true, force: true });
    } catch {
      // ignore if directory doesn't exist
    }

    return c.json({ ok: true });
  });

  return app;
}
