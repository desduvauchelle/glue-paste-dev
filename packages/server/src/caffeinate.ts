import type { Database } from "bun:sqlite";
import { cardsDb, log } from "@glue-paste-dev/core";
import type { Subprocess } from "bun";

let proc: Subprocess | null = null;

export function startCaffeinate(): void {
  if (process.platform !== "darwin") return;
  if (proc) return;

  proc = Bun.spawn(["caffeinate", "-i"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  log.info("caffeinate", "Started caffeinate (preventing idle sleep)");
}

export function stopCaffeinate(): void {
  if (!proc) return;
  proc.kill();
  proc = null;
  log.info("caffeinate", "Stopped caffeinate");
}

export function isCaffeinateActive(): boolean {
  return proc !== null;
}

export function checkAndToggleCaffeinate(db: Database): void {
  const count = cardsDb.countActiveCards(db);
  if (count > 0) {
    startCaffeinate();
  } else {
    stopCaffeinate();
  }
}
