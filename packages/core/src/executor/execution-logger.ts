import { homedir } from "os";
import { join } from "path";
import { mkdirSync, appendFileSync } from "fs";

const EXECUTIONS_DIR = join(homedir(), ".glue-paste-dev", "executions");

let dirCreated = false;

function ensureDir() {
  if (dirCreated) return;
  try {
    mkdirSync(EXECUTIONS_DIR, { recursive: true });
    dirCreated = true;
  } catch {
    // directory may already exist
    dirCreated = true;
  }
}

export function executionLogPath(executionId: string): string {
  return join(EXECUTIONS_DIR, `${executionId}.log`);
}

export function writeExecutionLog(executionId: string, line: string) {
  ensureDir();
  const ts = new Date().toISOString();
  appendFileSync(executionLogPath(executionId), `[${ts}] ${line}\n`);
}

export function writeExecutionLogRaw(executionId: string, data: string) {
  ensureDir();
  appendFileSync(executionLogPath(executionId), data);
}
