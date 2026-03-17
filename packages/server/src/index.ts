import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createBunWebSocket } from "hono/bun";
import { getDb } from "@glue-paste-dev/core";
import { boardRoutes } from "./routes/boards.js";
import { cardRoutes } from "./routes/cards.js";
import { commentRoutes } from "./routes/comments.js";
import { executionRoutes } from "./routes/executions.js";
import { queueRoutes, cardExecuteRoutes } from "./routes/queue.js";
import { configRoutes } from "./routes/config.js";
import { tagRoutes } from "./routes/tags.js";
import { filesystemRoutes } from "./routes/filesystem.js";
import type { ServerWebSocket } from "bun";

const { upgradeWebSocket, websocket } = createBunWebSocket();

// Initialize database
const db = getDb();

// Track connected WebSocket clients
const clients = new Set<ServerWebSocket<unknown>>();

export function broadcast(event: unknown): void {
  const message = JSON.stringify(event);
  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      clients.delete(client);
    }
  }
}

// Create Hono app
const app = new Hono();

// CORS for dev mode
app.use("/api/*", cors());

// API routes
app.route("/api/boards", boardRoutes(db, broadcast));
app.route("/api/cards", cardRoutes(db, broadcast));
app.route("/api/comments", commentRoutes(db, broadcast));
app.route("/api/executions", executionRoutes(db));
app.route("/api/queue", queueRoutes(db, broadcast));
app.route("/api/cards", cardExecuteRoutes(db, broadcast));
app.route("/api/config", configRoutes(db));
app.route("/api/tags", tagRoutes(db));
app.route("/api/filesystem", filesystemRoutes());

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws.raw as ServerWebSocket<unknown>);
    },
    onClose(_event, ws) {
      clients.delete(ws.raw as ServerWebSocket<unknown>);
    },
    onMessage(_event, _ws) {
      // Client messages handled here if needed
    },
  }))
);

// Serve static dashboard files (production)
app.use("*", serveStatic({ root: "./public" }));
app.use("*", serveStatic({ path: "./public/index.html" }));

const PORT = Number(process.env.PORT) || 4242;

console.log(`GluePasteDev server running on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};

export { db };
