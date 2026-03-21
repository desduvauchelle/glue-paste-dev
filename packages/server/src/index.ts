import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { createBunWebSocket } from "hono/bun";
import { getDb, log, cardsDb, executionsDb, killAllCardProcesses, killAllChatProcesses, killProcessTreeSync } from "@glue-paste-dev/core";
import { boardRoutes } from "./routes/boards.js";
import { cardRoutes } from "./routes/cards.js";
import { commentRoutes } from "./routes/comments.js";
import { executionRoutes } from "./routes/executions.js";
import { queueRoutes, cardExecuteRoutes } from "./routes/queue.js";
import { configRoutes } from "./routes/config.js";
import { tagRoutes } from "./routes/tags.js";
import { statsRoutes } from "./routes/stats.js";
import { fileRoutes } from "./routes/files.js";
import { chatRoutes } from "./routes/chat.js";
import { updateRoutes, startUpdateChecker } from "./routes/update.js";
import { caffeinateRoutes } from "./routes/caffeinate.js";
import { authRoutes } from "./routes/auth.js";
import { checkAndToggleCaffeinate, stopCaffeinate } from "./caffeinate.js";

import type { ServerWebSocket } from "bun";

const { upgradeWebSocket, websocket } = createBunWebSocket();

// Initialize database
const db = getDb();

// Recover cards that were interrupted by a previous shutdown/crash
const recovered = cardsDb.recoverInterruptedCards(db);
if (recovered.requeued + recovered.reset > 0) {
  log.info("server", `Recovered ${recovered.reset} interrupted card(s) → todo, ${recovered.requeued} card(s) → queued (plan preserved)`);
}

// Kill stale CLI processes from a previous server run
const stalePids = executionsDb.getRunningExecutionPids(db);
for (const pid of stalePids) {
  try {
    process.kill(pid, 0); // Check if alive
    killProcessTreeSync(pid);
    log.info("server", `Killed stale process PID ${pid}`);
  } catch {
    // already dead
  }
}

// Track connected WebSocket clients
const clients = new Set<ServerWebSocket<unknown>>();

export function broadcast(event: unknown): void {
  const message = JSON.stringify(event);
  log.debug("ws", `broadcast → ${(event as { type?: string }).type ?? "unknown"} to ${clients.size} clients`);
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

// Request logging middleware
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  log.info("api", `→ ${method} ${path}`);
  try {
    await next();
    const ms = Date.now() - start;
    log.info("api", `← ${method} ${path} ${c.res.status} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    log.error("api", `← ${method} ${path} 500 (${ms}ms)`, err);
    throw err;
  }
});

// API routes
app.route("/api/boards", boardRoutes(db, broadcast));
app.route("/api/cards", cardRoutes(db, broadcast));
app.route("/api/comments", commentRoutes(db, broadcast));
app.route("/api/executions", executionRoutes(db));
app.route("/api/queue", queueRoutes(db, broadcast));
app.route("/api/cards", cardExecuteRoutes(db, broadcast));
app.route("/api/config", configRoutes(db));
app.route("/api/tags", tagRoutes(db));
app.route("/api/stats", statsRoutes(db));
app.route("/api/files", fileRoutes(db));
app.route("/api/cards", chatRoutes(db, broadcast));
app.route("/api/update", updateRoutes(broadcast));
app.route("/api/caffeinate", caffeinateRoutes());
app.route("/api/auth", authRoutes());


// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      clients.add(ws.raw as ServerWebSocket<unknown>);
      log.info("ws", `Client connected (${clients.size} total)`);
    },
    onClose(_event, ws) {
      clients.delete(ws.raw as ServerWebSocket<unknown>);
      log.info("ws", `Client disconnected (${clients.size} total)`);
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

// Caffeinate: keep machine awake while tasks are active
checkAndToggleCaffeinate(db);
const caffeinateInterval = setInterval(() => checkAndToggleCaffeinate(db), 300_000);
const updateCheckInterval = startUpdateChecker(broadcast);
function gracefulShutdown() {
  clearInterval(caffeinateInterval);
  clearInterval(updateCheckInterval);
  stopCaffeinate();
  killAllCardProcesses();
  killAllChatProcesses();
  executionsDb.cancelRunningExecutions(db);
  process.exit(0);
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

console.log(`GluePasteDev server running on http://localhost:${PORT}`);
log.info("server", "Debug logging enabled (GPD_DEBUG)");

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};

export { db };
