import type { Database } from "bun:sqlite";
import { cardsDb, log } from "@glue-paste-dev/core";
import type { Subprocess } from "bun";

let proc: Subprocess | null = null;

const SUPPORTED_PLATFORMS = ["darwin", "win32"] as const;

export function isSleepPreventionSupported(): boolean {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(process.platform);
}

export function startCaffeinate(): void {
  if (proc) return;

  if (process.platform === "darwin") {
    proc = Bun.spawn(["caffeinate", "-i"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else if (process.platform === "win32") {
    proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class SleepUtil{[DllImport("kernel32.dll")]public static extern uint SetThreadExecutionState(uint esFlags);}'; while($true){[SleepUtil]::SetThreadExecutionState(0x80000001);Start-Sleep -Seconds 60}`,
      ],
      { stdout: "ignore", stderr: "ignore" }
    );
  } else {
    log.info("caffeinate", `Sleep prevention not supported on ${process.platform}`);
    return;
  }

  log.info("caffeinate", "Started sleep prevention");
}

export function stopCaffeinate(): void {
  if (!proc) return;
  proc.kill();
  proc = null;
  log.info("caffeinate", "Stopped sleep prevention");
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
