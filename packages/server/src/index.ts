import { cardsDb, executionsDb, getDb, killAllCardProcesses, killAllChatProcesses, killProcessTreeSync, log } from "@glue-paste-dev/core";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { checkAndToggleCaffeinate, stopCaffeinate } from "./caffeinate.js";
import { authRoutes } from "./routes/auth.js";
import { boardRoutes } from "./routes/boards.js";
import { caffeinateRoutes } from "./routes/caffeinate.js";
import { cardRoutes } from "./routes/cards.js";
import { chatRoutes } from "./routes/chat.js";
import { commentRoutes } from "./routes/comments.js";
import { commitRoutes } from "./routes/commits.js";
import { configRoutes } from "./routes/config.js";
import { executionRoutes } from "./routes/executions.js";
import { fileRoutes } from "./routes/files.js";
import { cardExecuteRoutes, queueRoutes } from "./routes/queue.js";
import { statsRoutes } from "./routes/stats.js";
import { tagRoutes } from "./routes/tags.js";
import { startUpdateChecker, updateRoutes } from "./routes/update.js";

import { existsSync } from "node:fs";
import { join } from "node:path";
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

// CORS — restrict to localhost origins only
app.use(
  "/api/*",
  cors({
    origin: origin => {
      if (!origin) return "*";
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return origin;
        }
      } catch {
        // invalid origin
      }
      return null as unknown as string;
    }
  })
);

// Security headers for HTML responses
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    c.res.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* wss://localhost:*; img-src 'self' data:; font-src 'self'"
    );
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
  }
});

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
  } catch (err: unknown) {
    const ms = Date.now() - start;
    log.error("api", `← ${method} ${path} 500 (${ms}ms)`, err);
    c.res = c.json({ error: "Internal server error" }, 500);
  }
});

// API routes
app.route("/api/boards", boardRoutes(db, broadcast));
app.route("/api/cards", cardRoutes(db, broadcast));
app.route("/api/comments", commentRoutes(db, broadcast));
app.route("/api/executions", executionRoutes(db));
app.route("/api/commits", commitRoutes(db));
app.route("/api/queue", queueRoutes(db, broadcast));
app.route("/api/cards", cardExecuteRoutes(db, broadcast));
app.route("/api/config", configRoutes(db, broadcast));
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
    }
  }))
);

// Serve static dashboard files (production)
const publicDir = existsSync(join(import.meta.dir, "public"))
  ? join(import.meta.dir, "public")
  : join(import.meta.dir, "..", "public");
app.use("*", serveStatic({ root: publicDir }));
app.use("*", serveStatic({ path: publicDir + "/index.html" }));

const PORT = Number(process.env.PORT) || 4242;

// Caffeinate: keep machine awake while tasks are active
checkAndToggleCaffeinate(db);
const caffeinateInterval = setInterval(() => checkAndToggleCaffeinate(db), 120_000);
const updateCheckInterval = startUpdateChecker(broadcast);
// Periodic WAL checkpoint to prevent unbounded WAL growth
const walCheckpointInterval = setInterval(
  () => {
    try {
      db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    } catch {}
  },
  5 * 60 * 1000
);
function gracefulShutdown() {
  clearInterval(caffeinateInterval);
  clearInterval(updateCheckInterval);
  clearInterval(walCheckpointInterval);
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
  websocket
};

export { db };
