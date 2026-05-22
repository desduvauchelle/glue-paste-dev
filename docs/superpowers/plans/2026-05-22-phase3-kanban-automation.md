# Phase 3 — Kanban automation + drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted `session_state` (`working | idle | null`) card field rendered as a badge, drive working/idle from the live PTY (so manual "continue" also updates it), automate drag→Done/ToDo/Queued session teardown, and LRU-evict idle terminal sessions over a cap.

**Architecture:** `session_state` becomes a real card column, persisted and broadcast on the existing `card:updated` event. The `TerminalHub` gains a working-transition event (`onBusy`, complement of `onIdle`) plus per-session `lastActivity` and an open-session cap with LRU eviction. The server singleton (now db-aware) maps hub `onIdle`/`onBusy` → `setSessionState` + `card:updated`, and exposes a session-kill endpoint used by drag automation. The dashboard renders the badge, derives the terminal input-lock from `card.session_state`, and on drag to Done/ToDo/Queued tears down the session.

**Tech Stack:** Bun + bun:sqlite (core), Hono (server), React 19 + Tailwind v4 (dashboard). Builds on `phase2/terminal-is-run`. Source of truth: `docs/superpowers/specs/2026-05-22-interactive-terminal-unified-run-design.md` (Phase 3 section + locked decisions 2, 7, 8).

---

## Conventions

- Core tests: `cd packages/core && bun test`. Server: `cd packages/server && bun test`. Dashboard: `bunx vitest run`. Type checks: core/server `bunx tsc --noEmit`, dashboard `bunx tsc -b` (TS6305 → `bunx tsc -b --force`).
- Husky pre-commit runs core+cli+dashboard tests + bumps root version — expected. Commit per task; do not push until finished.
- No `any`/`@ts-ignore`. Follow existing patterns (mirror `setBlocker`, the badge zone, the FakeSession hub tests).

## File Structure

**Core**
- `packages/core/src/db/schema.ts` — add `ALTER TABLE cards ADD COLUMN session_state TEXT DEFAULT NULL` migration.
- `packages/core/src/db/cards.ts` — `CardRow` + `toCardWithTags` mapper gain `session_state`; add `setSessionState`.
- `packages/core/src/schemas/card.ts` — `CardSchema`/`CardWithTagsSchema` gain `session_state`.
- `packages/core/src/types/*` — `Card`/`CardWithTags` (derived from Zod) carry it automatically.
- `packages/core/src/terminal/terminal-hub.ts` — `onBusy` event, `lastActivity`, `maxSessions` cap + LRU eviction.
- `packages/core/src/terminal/index.ts` — `createTerminalHub` threads `onBusy` + `maxSessions`.
- `packages/core/src/executor/pty-runner.ts` — set `session_state="working"` at run start.
- `packages/core/src/executor/queue.ts` — clear `session_state` on stop/failure (+ export already-present `clearAwaitingReview`).
- `packages/core/src/index.ts` — export `setSessionState`.

**Server**
- `packages/server/src/terminal-hub-singleton.ts` — `getTerminalHub(broadcast, mode, db)`: `onIdle`/`onBusy` → `setSessionState` + `card:updated`; pass `maxSessions`.
- `packages/server/src/index.ts` — pass `db` to all `getTerminalHub(...)` calls.
- `packages/server/src/routes/terminal.ts` — `POST /:id/session/kill` (close session + `session_state=null` + `clearAwaitingReview` + broadcast).

**Dashboard**
- `packages/dashboard/src/lib/api.ts` — local `CardWithTags` gains `session_state`; add `terminal.killSession`.
- `packages/dashboard/src/components/board/KanbanCard.tsx` — `session_state` badge.
- `packages/dashboard/src/hooks/use-terminal.ts` — derive `working` from `card.session_state` via `card:updated`.
- `packages/dashboard/src/components/board/BoardView.tsx` — `handleReorderCards` drag automation.

---

## Task 1: Core — `session_state` field (db + schema + setter)

**Files:** `db/schema.ts`, `db/cards.ts`, `schemas/card.ts`; test `src/__tests__/db/cards.test.ts`.

- [ ] **Step 1: Failing test** in `cards.test.ts` (mirror existing `setBlocker` tests): create a card, `setSessionState(db, card.id, "working")`, `getCard` → `session_state === "working"`; set `"idle"` → idle; set `null` → null. New cards default `session_state === null`.
- [ ] **Step 2:** Run → fail (`setSessionState` missing / column missing).
- [ ] **Step 3: Implement.**
  - `schema.ts`: after the `blocker` ADD COLUMN block, append:
    ```ts
    try {
      db.exec(`ALTER TABLE cards ADD COLUMN session_state TEXT DEFAULT NULL`);
    } catch { /* Column already exists — ignore */ }
    ```
  - `db/cards.ts`: add `session_state: string | null` to the `CardRow` interface; in `toCardWithTags` map `session_state: (row.session_state as "working" | "idle" | null) ?? null`. Add setter mirroring `setBlocker`:
    ```ts
    export function setSessionState(db: Database, id: CardId, state: "working" | "idle" | null): void {
      db.query("UPDATE cards SET session_state = ?, updated_at = datetime('now') WHERE id = ?").run(state, id);
    }
    ```
  - `schemas/card.ts`: add `session_state: z.enum(["working", "idle"]).nullable().default(null)` to `CardSchema` (and `CardWithTagsSchema` if it doesn't extend `CardSchema`).
- [ ] **Step 4:** Run → pass. `bunx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(core): add card session_state field + setSessionState`.

## Task 2: Core — export `setSessionState`; set working at run start; clear on stop/fail

**Files:** `executor/pty-runner.ts`, `executor/queue.ts`, `src/index.ts`; extend `src/__tests__/executor/queue-interactive.test.ts`.

- [ ] **Step 1: Failing test** (queue-interactive style): on interactive run start the card's `session_state` becomes `"working"`; on the failure (early-exit) path it ends `null`; `stopCard` sets it `null`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.**
  - `pty-runner.ts`: right after `cardsDb.updateCardStatus(db, card.id, "in-progress")` add `cardsDb.setSessionState(db, card.id as CardId, "working");` (before the `getCard`/`onCardUpdated` so the broadcast carries it). On the FAILURE branch (turnEnd.reason === "exit") add `cardsDb.setSessionState(db, card.id as CardId, null);` before the final `onCardUpdated`. (Do NOT set idle here — the server `onIdle` handles idle; see Task 4. Optionally also set `"idle"` on the success branch for robustness — acceptable, idempotent with Task 4.)
  - `queue.ts`: in `stopCard` add `cardsDb.setSessionState(db, cardId, null);`. In the interactive FAILURE post-run handling (both `processCard` and `executeSingleCard`) add `cardsDb.setSessionState(db, cardId, null);` next to the `updateCardStatus(..., "failed")`.
  - `src/index.ts` (core barrel): add `setSessionState` to the `db/cards.js` re-exports.
- [ ] **Step 4:** Run → pass. tsc clean. Full `bun test`.
- [ ] **Step 5: Commit** `feat(core): set/clear card session_state across run lifecycle`.

## Task 3: Core hub — `onBusy` event, `lastActivity`, LRU eviction

**Files:** `terminal/terminal-hub.ts`, `terminal/index.ts`; extend `terminal/__tests__/terminal-hub.test.ts`.

- [ ] **Step 1: Failing tests** (FakeSession pattern):
  - `onBusy` fires on the idle→busy transition: after an idle sample sets idle, a subsequent non-idle chunk fires `onBusy(cardId)` exactly once (re-arms with the next idle).
  - LRU eviction: construct a hub with `maxSessions: 2`; open c1, emit idle (c1 idle), open c2, emit idle (c2 idle), open c3 → the oldest IDLE session (c1) is closed (`isRunning("c1") === false` / its session.kill called) while c2/c3 remain. A WORKING (non-idle) or watched session must NOT be evicted (open c4 when only working sessions exist → no eviction, just opens).
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.**
  - `TerminalHubOptions`: add `onBusy?: (cardId: string) => void;` and `maxSessions?: number;` (default e.g. 12).
  - `SessionEntry`: add `lastActivity: number;` (init `Date.now()` in `open`).
  - `handleData`: set `e.lastActivity = Date.now();` (top, after fetching `e`). In the idle block, change the busy branch to fire `onBusy` on the true→false transition:
    ```ts
    if (e.idleDetectionActive) {
      const idle = detectIdle(chunk);
      if (idle && !e.wasIdle) {
        e.wasIdle = true;
        this.opts.onIdle?.(cardId);
        const waiters = e.turnEndWaiters; e.turnEndWaiters = [];
        for (const w of waiters) w({ reason: "idle" });
      } else if (!idle && e.wasIdle) {
        e.wasIdle = false;
        this.opts.onBusy?.(cardId);
      }
    }
    ```
  - `open`: BEFORE creating the session, if `this.maxSessions` is set and `this.sessions.size >= this.maxSessions`, evict: among entries with `wasIdle === true && !this.isWatched(id)`, pick the smallest `lastActivity` and `this.close(it)`. If none evictable, proceed without evicting. Store `maxSessions` from opts in the constructor.
  - `index.ts` `createTerminalHub`: thread `onBusy` and `maxSessions` through (mirror the existing optional `onIdle` spread).
- [ ] **Step 4:** Run → pass. tsc clean.
- [ ] **Step 5: Commit** `feat(core): hub onBusy event + lastActivity + LRU idle eviction`.

## Task 4: Server — db-aware singleton, session_state broadcast, kill endpoint

**Files:** `terminal-hub-singleton.ts`, `index.ts`, `routes/terminal.ts`; tests `__tests__/terminal-hub-singleton.test.ts`, `__tests__/routes/terminal.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `getTerminalHub(broadcast, mode, db)`: triggering the captured `onIdle` calls `setSessionState(db, cardId, "idle")` and broadcasts `card:updated`; triggering `onBusy` sets `"working"` + `card:updated`. (Mock `createTerminalHub` to capture callbacks, as the existing test does; use a real test db for the setSessionState assertion.)
  - `POST /api/cards/:id/session/kill` → calls `hub.close(cardId)`, sets `session_state` null, returns `{ ok: true }`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.**
  - `terminal-hub-singleton.ts`: change signature to `getTerminalHub(broadcast, permissionMode, db: Database)`. In `createTerminalHub`, add:
    ```ts
    onIdle: (cardId) => {
      cardsDb.setSessionState(db, cardId as CardId, "idle");
      broadcast({ type: "execution:idle", payload: { cardId } });
      const card = cardsDb.getCard(db, cardId as CardId);
      if (card) broadcast({ type: "card:updated", payload: card });
    },
    onBusy: (cardId) => {
      cardsDb.setSessionState(db, cardId as CardId, "working");
      const card = cardsDb.getCard(db, cardId as CardId);
      if (card) broadcast({ type: "card:updated", payload: card });
    },
    maxSessions: 12,
    ```
    (import `cardsDb` + `CardId` from `@glue-paste-dev/core`.)
  - `index.ts`: pass `db` to EVERY `getTerminalHub(broadcast, mode)` call (startup wiring, ws onMessage, ws onClose, gracefulShutdown) → `getTerminalHub(broadcast, mode, db)`.
  - `routes/terminal.ts`: every `getTerminalHub(broadcast, permissionMode)` → add `db`. Add the route:
    ```ts
    app.post("/:id/session/kill", (c) => {
      const cardId = c.req.param("id") as CardId;
      const permissionMode = (getGlobalConfig(db).terminalPermissionMode ?? "auto-unless-watching") as TerminalPermissionMode;
      const hub = getTerminalHub(broadcast, permissionMode, db);
      hub.close(cardId);
      cardsDb.setSessionState(db, cardId, null);
      clearAwaitingReview(cardId);
      const card = cardsDb.getCard(db, cardId);
      if (card) broadcast({ type: "card:updated", payload: card });
      return c.json({ ok: true });
    });
    ```
    (import `clearAwaitingReview` from `@glue-paste-dev/core`.)
- [ ] **Step 4:** Run → pass. tsc clean (core + server). `bun test`.
- [ ] **Step 5: Commit** `feat(server): session_state broadcast from hub + session kill endpoint`.

## Task 5: Dashboard — type, badge, input-lock from session_state

**Files:** `lib/api.ts`, `components/board/KanbanCard.tsx`, `hooks/use-terminal.ts`; tests `KanbanCard.test.tsx` (new), extend `use-terminal.test.ts`.

- [ ] **Step 1: Failing tests.**
  - KanbanCard: renders a "working" badge when `session_state==="working"` and a "your turn" badge when `"idle"`; none when `null`.
  - use-terminal: a `card:updated` event for THIS card with `session_state==="working"` sets `working=true`; `"idle"`/`null` sets `working=false`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.**
  - `lib/api.ts`: add `session_state: "working" | "idle" | null;` to the local `CardWithTags` (after `blocker`).
  - `KanbanCard.tsx`: extend the badge-zone guard (line ~276) with `|| card.session_state != null`, and at the TOP of the flex-wrap div render:
    ```tsx
    {card.session_state === "working" && (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Working
      </span>
    )}
    {card.session_state === "idle" && (
      <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">Your turn</span>
    )}
    ```
    (Match the existing badge class conventions in the file.)
  - `hooks/use-terminal.ts`: in the existing `useWebSocket` handler add a `card:updated` branch: if `payload.id === cardId`, `setWorking(payload.session_state === "working")`. Keep the `terminal:exit` → `setWorking(false)` safety. You MAY remove the `execution:started`/`execution:idle` working logic now that session_state is authoritative, but keep `execution:idle` handling if other code depends on it — minimum: ensure `card:updated.session_state` is the source of truth for `working`.
- [ ] **Step 4:** Run → pass. `bunx tsc -b` clean. `bunx vitest run`.
- [ ] **Step 5: Commit** `feat(dashboard): session_state badge + input-lock from session_state`.

## Task 6: Dashboard — drag automation (Done/ToDo/Queued teardown)

**Files:** `lib/api.ts` (killSession), `components/board/BoardView.tsx`; tests `__tests__/kanban-constraints.test.ts` or a BoardView logic test.

- [ ] **Step 1: Failing test** (follow the existing pure-logic `kanban-constraints` pattern, or a small unit around a helper): given a card with a session (`session_state != null`) dragged to `done`/`todo`/`queued`, the automation calls `killSession(id)`; dragged to `in-progress` it calls `execute` (existing) and NOT killSession; a card with `session_state == null` dragged to done does nothing extra.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3: Implement.**
  - `lib/api.ts`: add to the `terminal` object:
    ```ts
    killSession: (cardId: string) =>
      request<{ ok: boolean }>(`/cards/${cardId}/session/kill`, { method: "POST" }),
    ```
  - `BoardView.tsx` `handleReorderCards`: after `await reorder(updates)`, for each update whose target status is `done`, `todo`, or `queued` AND whose pre-move card had `session_state != null` (look it up in `grouped`/the cards list before the move), call `void terminal.killSession(u.id)`. Keep the existing `→ in-progress` execute branch and the `→ queued` `tryStartQueue` branch. Ensure ordering: killSession before/independent of enqueue is fine (kill just tears down the stale session; the fresh run re-opens).
- [ ] **Step 4:** Run → pass. tsc + vitest.
- [ ] **Step 5: Commit** `feat(dashboard): drag automation tears down interactive session on Done/ToDo/Queued`.

## Task 7: Verification

- [ ] Full sweep: core/server/dashboard tsc + tests all green.
- [ ] Confirm cross-layer consistency: `session_state` set (pty-runner working, singleton onIdle idle, onBusy working, kill→null) → broadcast `card:updated` → dashboard badge + input-lock; drag → killSession → session_state null.
- [ ] Manual E2E is deferred to the combined Phase 2+3 check (run a real card: badge shows Working→Your turn, type to continue flips Working, drag to Done kills session, LRU evicts oldest idle over cap).
- [ ] Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-Review notes (author)

- **Spec coverage (Phase 3):** session_state field + badge (Task 1/5); column automation = badge-only within in-progress + drag map (Task 6, server kill Task 4); drag→Done/ToDo/Queued (Task 6 + Task 4 endpoint); continue-while-idle reflected via `onBusy`→working (Task 3/4/5); concurrency unchanged (Phase 2 frees slot on idle); LRU eviction (Task 3). Covered.
- **Manual continue** is the reason for `onBusy`: typing into an idle session doesn't go through the queue/`execution:started`, so working state must come from the PTY transition, not the run path.
- **No double source of truth for the badge:** `session_state` (persisted) is authoritative; the Phase-2 in-memory `interactiveAwaitingReview` Set stays only as the queue's re-pick guard.
- **Risk:** drag automation depends on the dashboard knowing the pre-move `session_state`; read it from current card state before applying the move. LRU eviction must never evict a watched/working session.
