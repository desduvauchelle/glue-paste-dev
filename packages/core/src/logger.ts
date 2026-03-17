/**
 * Simple debug logger controlled by GPD_DEBUG env var.
 *
 * Set GPD_DEBUG=1 (or any truthy value) to enable.
 * Unset or GPD_DEBUG=0 to disable.
 *
 * Usage:
 *   import { log } from "./logger.js";
 *   log.info("server", "Listening on port", 4242);
 *   log.error("api", "Failed to create card", err);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

function isEnabled(): boolean {
  const val = typeof process !== "undefined" ? process.env.GPD_DEBUG : undefined;
  return val !== undefined && val !== "" && val !== "0" && val !== "false";
}

function getMinLevel(): LogLevel {
  const val = typeof process !== "undefined" ? process.env.GPD_DEBUG_LEVEL : undefined;
  if (val && val in LEVEL_PRIORITY) return val as LogLevel;
  return "debug";
}

function write(level: LogLevel, scope: string, ...args: unknown[]) {
  if (!isEnabled()) return;
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[getMinLevel()]) return;

  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${LEVEL_LABEL[level]}] [${scope}]`;

  if (level === "error" || level === "warn") {
    console.error(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

export const log = {
  debug: (scope: string, ...args: unknown[]) => write("debug", scope, ...args),
  info: (scope: string, ...args: unknown[]) => write("info", scope, ...args),
  warn: (scope: string, ...args: unknown[]) => write("warn", scope, ...args),
  error: (scope: string, ...args: unknown[]) => write("error", scope, ...args),
};
