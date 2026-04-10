# Update Silent Failure Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon update flow observable and reliable by surfacing silent failures and adding a dashboard timeout.

**Architecture:** Three layers need changes: (1) the server's `apply` route pipes CLI subprocess output to the log file instead of discarding it; (2) the CLI `update()` command writes progress to the daemon log file directly so it's visible regardless of how it was invoked; (3) the dashboard `UpdateButton` adds a timeout so the UI doesn't hang forever when the daemon fails to restart.

**Tech Stack:** Bun (server + CLI), React 19 + Vitest (dashboard), Hono (server routes), node:fs appendFileSync (log writing)

---

## Background: What's Broken

The `POST /api/update/apply` route spawns a CLI subprocess to download, extract, and restart the daemon. The spawn uses `stdout: "ignore", stderr: "ignore"`. Any failure (curl error, tar failure, missing file, restart error) is silently discarded. Meanwhile:

- The log viewer (`GET /api/update/logs`) returns only the **last 20** update-tagged lines. Background checks produce ~5 lines per cycle. After 4 cycles (2 hours), any apply-related log lines are pushed out of the window, making past failures invisible.
- The dashboard shows a spinning "updating" icon with no timeout — if the daemon never restarts, the UI is permanently stuck.

Result: the user clicks "Update", the process silently fails, the daemon restarts the old version (or doesn't restart at all), and every 30-minute background check helpfully announces the same update is still available.

---

## File Map

| File | Change |
|---|---|
| `packages/server/src/routes/update.ts` | Pipe CLI subprocess output to log file; expand log window to 50 |
| `packages/cli/src/commands/update.ts` | Add `appendFileSync` calls so progress is written to daemon log |
| `packages/dashboard/src/components/UpdateButton.tsx` | Add 90-second timeout; show "Timed out" error with retry |
| `packages/server/src/__tests__/routes/update.test.ts` | Add test documenting log-file spawn contract |
| `packages/cli/src/commands/update.test.ts` | Add test asserting log file writes happen |
| `packages/dashboard/src/components/UpdateButton.test.tsx` | New test file: assert timeout contract |

---

### Task 1: Pipe CLI subprocess output to daemon log file

- [x] Pipe subprocess stdout/stderr to Bun.file(logPath)
- [x] Expand log window from 20 to 50 lines

### Task 2: Add log-file writes to CLI update command

- [x] Add logUpdate() helper with appendFileSync
- [x] Add logUpdate() calls at each step of update()

### Task 3: Add timeout to dashboard "updating" state

- [x] Add 90-second timeout via useEffect + useRef
- [x] Transition to "error" state on timeout
