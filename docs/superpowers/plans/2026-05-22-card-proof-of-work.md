# Card Proof of Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured acceptance criteria, self-reported per-criterion proof of work, a structured plan summary, blocker analysis, and a completion summary to every card.

**Architecture:** A new `card_criteria` table plus three JSON columns on `cards` hold the artifacts. After each AI phase, a cheap Claude Haiku one-shot call (mirroring `generate-title.ts`) extracts structured JSON: the plan phase seeds criteria + plan summary; the execute phase fills per-criterion verdicts + evidence, a completion summary, or a blocker. Artifacts are folded into `CardWithTags`, so the existing `card:updated` WebSocket event carries them. The dashboard gains `Plan` and `Criteria & Proof` tabs plus a completion/blocker banner. Extraction is best-effort and never breaks card execution. The independent review-gate is out of scope (deferred).

**Tech Stack:** Bun + bun:sqlite + Zod (core), Hono (server), React 19 + Vite + Tailwind v4 (dashboard). Tests: `bun test` (core), Vitest (server, dashboard).

**Spec:** `docs/superpowers/specs/2026-05-22-card-proof-of-work-design.md`

---

## File Structure

**New files:**
- `packages/core/src/schemas/criterion.ts` — Criterion Zod schemas + branded id.
- `packages/core/src/schemas/report.ts` — extraction report Zod schemas (plan summary, blocker, plan report, execute report).
- `packages/core/src/db/criteria.ts` — criteria CRUD + verdict upsert.
- `packages/core/src/executor/extract-report.ts` — Haiku extraction calls + report-file writer.
- `packages/core/src/__tests__/db/criteria.test.ts` — criteria DB tests.
- `packages/core/src/__tests__/executor/extract-report.test.ts` — extraction parsing tests.
- `packages/server/src/routes/criteria.ts` — manual criterion CRUD routes.
- `packages/server/src/__tests__/routes/criteria.test.ts` — route integration tests.
- `packages/dashboard/src/components/board/PlanPanel.tsx` — renders plan summary.
- `packages/dashboard/src/components/board/CriteriaList.tsx` — renders + edits criteria.
- `packages/dashboard/src/components/board/PlanPanel.test.tsx`, `CriteriaList.test.tsx` — component tests.

**Modified files:**
- `packages/core/src/db/schema.ts` — `card_criteria` table + `cards` columns (migrations).
- `packages/core/src/schemas/card.ts` — extend `CardWithTagsSchema`.
- `packages/core/src/types/index.ts` — export new types.
- `packages/core/src/index.ts` — export new schemas + `criteriaDb`.
- `packages/core/src/db/cards.ts` — hydrate new fields + setter helpers.
- `packages/core/src/executor/prompt.ts` — add `## Acceptance Criteria` to execute prompt.
- `packages/core/src/executor/runner.ts` — extraction hooks in `executePhase`.
- `packages/server/src/index.ts` — register criteria routes.
- `packages/dashboard/src/lib/api.ts` — `criteria` API object.
- `packages/dashboard/src/components/board/CardDialog.tsx` — new tabs + banner.
- `packages/dashboard/src/components/board/KanbanCard.tsx` — criteria progress badge.

---

## Phase 1 — Schema, DB, Zod types

### Task 1: Criterion + report Zod schemas

**Files:**
- Create: `packages/core/src/schemas/criterion.ts`
- Create: `packages/core/src/schemas/report.ts`
- Test: `packages/core/src/schemas/__tests__/criterion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/schemas/__tests__/criterion.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { CriterionSchema, CreateCriterionSchema } from "../criterion.js";
import { ExecuteReportSchema, PlanReportSchema } from "../report.js";

describe("criterion schemas", () => {
  it("parses a full criterion row with defaults", () => {
    const c = CriterionSchema.parse({
      id: "abc",
      card_id: "card1",
      text: "App builds",
      created_at: "2026-05-22",
      updated_at: "2026-05-22",
    });
    expect(c.status).toBe("pending");
    expect(c.source).toBe("ai");
    expect(c.evidence).toBeNull();
  });

  it("rejects empty create text", () => {
    expect(CreateCriterionSchema.safeParse({ text: "" }).success).toBe(false);
  });
});

describe("report schemas", () => {
  it("parses a plan report", () => {
    const r = PlanReportSchema.parse({
      criteria: ["a", "b"],
      plan_summary: { key_files: ["x.ts"], risks: [], dependencies: [] },
    });
    expect(r.criteria).toHaveLength(2);
  });

  it("parses an execute report with verdicts", () => {
    const r = ExecuteReportSchema.parse({
      criteria: [{ id: "c1", status: "pass", evidence: "tests green" }],
      completion_summary: "done",
      blocker: null,
    });
    expect(r.criteria[0].status).toBe("pass");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/schemas/__tests__/criterion.test.ts`
Expected: FAIL — cannot find module `../criterion.js`.

- [ ] **Step 3: Create `packages/core/src/schemas/criterion.ts`**

```ts
import { z } from "zod";

export const CriterionIdSchema = z.string().brand<"CriterionId">();
export const CriterionStatus = z.enum(["pending", "pass", "fail"]);
export const CriterionSource = z.enum(["ai", "user"]);

export const CriterionSchema = z.object({
  id: CriterionIdSchema,
  card_id: z.string(),
  text: z.string(),
  status: CriterionStatus.default("pending"),
  source: CriterionSource.default("ai"),
  evidence: z.string().nullable().default(null),
  execution_id: z.string().nullable().default(null),
  position: z.number().int().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export const CreateCriterionSchema = z.object({
  text: z.string().min(1).max(2000),
});

export const UpdateCriterionSchema = z.object({
  text: z.string().min(1).max(2000).optional(),
  status: CriterionStatus.optional(),
});

export const ReorderCriteriaSchema = z.array(
  z.object({ id: CriterionIdSchema, position: z.number().int() })
);
```

- [ ] **Step 4: Create `packages/core/src/schemas/report.ts`**

```ts
import { z } from "zod";

export const PlanSummarySchema = z.object({
  key_files: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
});

export const BlockerSchema = z.object({
  type: z.string(),
  root_cause: z.string(),
  resolution_route: z.string(),
});

export const PlanReportSchema = z.object({
  criteria: z.array(z.string()).default([]),
  plan_summary: PlanSummarySchema,
});

export const ExecuteReportSchema = z.object({
  criteria: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["pass", "fail"]),
        evidence: z.string().default(""),
      })
    )
    .default([]),
  completion_summary: z.string().default(""),
  blocker: BlockerSchema.nullable().default(null),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test src/schemas/__tests__/criterion.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/criterion.ts packages/core/src/schemas/report.ts packages/core/src/schemas/__tests__/criterion.test.ts
git commit -m "feat(core): add criterion and report zod schemas"
```

---

### Task 2: Export new types and barrels

**Files:**
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add type imports + exports in `packages/core/src/types/index.ts`**

After the commit-types import block (around line 34), add:

```ts
import type {
  CriterionSchema,
  CriterionIdSchema,
  CriterionStatus,
} from "../schemas/criterion.js";
import type {
  PlanSummarySchema,
  BlockerSchema,
  PlanReportSchema,
  ExecuteReportSchema,
} from "../schemas/report.js";
```

After the Commit types block (around line 72), add:

```ts
// Criterion types
export type Criterion = z.infer<typeof CriterionSchema>;
export type CriterionId = z.infer<typeof CriterionIdSchema>;
export type CriterionStatusType = z.infer<typeof CriterionStatus>;

// Report types
export type PlanSummary = z.infer<typeof PlanSummarySchema>;
export type Blocker = z.infer<typeof BlockerSchema>;
export type PlanReport = z.infer<typeof PlanReportSchema>;
export type ExecuteReport = z.infer<typeof ExecuteReportSchema>;
```

- [ ] **Step 2: Add schema + db exports in `packages/core/src/index.ts`**

In the Schemas block (after `export * from "./schemas/commit.js";`), add:

```ts
export * from "./schemas/criterion.js";
export * from "./schemas/report.js";
```

In the Database block (after `export * as commitsDb from "./db/commits.js";`), add:

```ts
export * as criteriaDb from "./db/criteria.js";
```

> Note: `db/criteria.ts` does not exist yet — it is created in Task 4. This export will fail type-check until then; that is expected and resolved in Task 4. Do not run a full type-check between Task 2 and Task 4.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/index.ts packages/core/src/index.ts
git commit -m "feat(core): export criterion/report types and criteriaDb"
```

---

### Task 3: Database schema — `card_criteria` table + `cards` columns

**Files:**
- Modify: `packages/core/src/db/schema.ts`
- Test: `packages/core/src/__tests__/db/schema-criteria.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/db/schema-criteria.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
});

describe("schema: criteria + card columns", () => {
  it("creates card_criteria table", () => {
    const cols = db.query("PRAGMA table_info(card_criteria)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("status");
    expect(names).toContain("evidence");
    expect(names).toContain("execution_id");
    expect(names).toContain("position");
  });

  it("adds plan_summary, completion_summary, blocker columns to cards", () => {
    const cols = db.query("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("plan_summary");
    expect(names).toContain("completion_summary");
    expect(names).toContain("blocker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/__tests__/db/schema-criteria.test.ts`
Expected: FAIL — `card_criteria` has no columns / cards missing `plan_summary`.

- [ ] **Step 3: Add the table to the main `db.exec` block in `initSchema`**

In `packages/core/src/db/schema.ts`, inside the first `db.exec(\`...\`)` block, after the `card_commits` table definition (before the `CREATE INDEX` lines around line 89), add:

```sql
    CREATE TABLE IF NOT EXISTS card_criteria (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','pass','fail')),
      source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai','user')),
      evidence TEXT DEFAULT NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

In the same block, in the `CREATE INDEX` group, add:

```sql
    CREATE INDEX IF NOT EXISTS idx_card_criteria_card_id ON card_criteria(card_id);
```

- [ ] **Step 4: Add idempotent migrations at the end of `initSchema`**

At the end of `initSchema` (after the last `branch_name` migration block, around line 390), add:

```ts
  // Migration: add card_criteria table for existing databases
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS card_criteria (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','pass','fail')),
      source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai','user')),
      evidence TEXT DEFAULT NULL,
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_card_criteria_card_id ON card_criteria(card_id)`);
  } catch {
    // Table already exists — ignore
  }

  // Migration: add proof-of-work columns to cards
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN plan_summary TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN completion_summary TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN blocker TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test src/__tests__/db/schema-criteria.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/__tests__/db/schema-criteria.test.ts
git commit -m "feat(core): add card_criteria table and card proof-of-work columns"
```

---

### Task 4: Criteria DB layer

**Files:**
- Create: `packages/core/src/db/criteria.ts`
- Test: `packages/core/src/__tests__/db/criteria.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/db/criteria.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import { createCard } from "../../db/cards.js";
import {
  getCriteria,
  getCriterion,
  seedCriteria,
  setCriterionResult,
  createCriterion,
  updateCriterion,
  deleteCriterion,
  reorderCriteria,
} from "../../db/criteria.js";
import type { BoardId, CardId, CriterionId } from "../../types/index.js";

let db: Database;
let cardId: CardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  const board = createBoard(db, { name: "T", description: "", directory: "/tmp/t" });
  const card = createCard(db, board.id as BoardId, { title: "Card", tags: [] });
  cardId = card.id as CardId;
});

describe("criteria db", () => {
  it("seeds criteria only when none exist", () => {
    const first = seedCriteria(db, cardId, ["a", "b"]);
    expect(first).toHaveLength(2);
    expect(first[0].source).toBe("ai");
    const second = seedCriteria(db, cardId, ["c"]);
    expect(second).toHaveLength(2); // unchanged — already seeded
  });

  it("sets a verdict + evidence by id", () => {
    const [c] = seedCriteria(db, cardId, ["builds"]);
    setCriterionResult(db, c.id as CriterionId, "pass", "tests green", null);
    const got = getCriterion(db, c.id as CriterionId);
    expect(got?.status).toBe("pass");
    expect(got?.evidence).toBe("tests green");
  });

  it("supports manual create/update/delete", () => {
    const created = createCriterion(db, cardId, "manual one");
    expect(created.source).toBe("user");
    updateCriterion(db, created.id as CriterionId, { text: "edited", status: "fail" });
    const after = getCriterion(db, created.id as CriterionId);
    expect(after?.text).toBe("edited");
    expect(after?.status).toBe("fail");
    expect(deleteCriterion(db, created.id as CriterionId)).toBe(true);
    expect(getCriterion(db, created.id as CriterionId)).toBeNull();
  });

  it("reorders criteria", () => {
    const seeded = seedCriteria(db, cardId, ["a", "b"]);
    reorderCriteria(db, [
      { id: seeded[1].id as CriterionId, position: 0 },
      { id: seeded[0].id as CriterionId, position: 1 },
    ]);
    const ordered = getCriteria(db, cardId);
    expect(ordered[0].text).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/__tests__/db/criteria.test.ts`
Expected: FAIL — cannot find module `../../db/criteria.js`.

- [ ] **Step 3: Create `packages/core/src/db/criteria.ts`**

```ts
import type { Database } from "bun:sqlite";
import type { CardId, Criterion, CriterionId, ExecutionId } from "../types/index.js";

interface CriterionRow {
  id: string;
  card_id: string;
  text: string;
  status: string;
  source: string;
  evidence: string | null;
  execution_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function toCriterion(row: CriterionRow): Criterion {
  return {
    ...row,
    status: row.status as Criterion["status"],
    source: row.source as Criterion["source"],
    evidence: row.evidence ?? null,
    execution_id: row.execution_id ?? null,
  } as Criterion;
}

export function getCriteria(db: Database, cardId: CardId): Criterion[] {
  const rows = db
    .query("SELECT * FROM card_criteria WHERE card_id = ? ORDER BY position ASC, created_at ASC")
    .all(cardId) as CriterionRow[];
  return rows.map(toCriterion);
}

export function getCriterion(db: Database, id: CriterionId): Criterion | null {
  const row = db.query("SELECT * FROM card_criteria WHERE id = ?").get(id) as CriterionRow | null;
  return row ? toCriterion(row) : null;
}

/** Insert AI-generated criteria only when the card has none yet (idempotent seeding). */
export function seedCriteria(db: Database, cardId: CardId, texts: string[]): Criterion[] {
  const existing = getCriteria(db, cardId);
  if (existing.length > 0) return existing;
  const stmt = db.query(
    "INSERT INTO card_criteria (card_id, text, source, position) VALUES (?, ?, 'ai', ?) RETURNING *"
  );
  const results: Criterion[] = [];
  const tx = db.transaction(() => {
    texts.forEach((text, i) => {
      const row = stmt.get(cardId, text, i) as CriterionRow;
      results.push(toCriterion(row));
    });
  });
  tx();
  return results;
}

export function setCriterionResult(
  db: Database,
  id: CriterionId,
  status: "pass" | "fail",
  evidence: string,
  executionId: ExecutionId | null
): void {
  db.query(
    "UPDATE card_criteria SET status = ?, evidence = ?, execution_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, evidence, executionId, id);
}

export function createCriterion(db: Database, cardId: CardId, text: string): Criterion {
  const nextPos = (
    db
      .query("SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM card_criteria WHERE card_id = ?")
      .get(cardId) as { next_pos: number }
  ).next_pos;
  const row = db
    .query(
      "INSERT INTO card_criteria (card_id, text, source, position) VALUES (?, ?, 'user', ?) RETURNING *"
    )
    .get(cardId, text, nextPos) as CriterionRow;
  return toCriterion(row);
}

export function updateCriterion(
  db: Database,
  id: CriterionId,
  input: { text?: string; status?: "pending" | "pass" | "fail" }
): Criterion | null {
  const current = db.query("SELECT * FROM card_criteria WHERE id = ?").get(id) as CriterionRow | null;
  if (!current) return null;
  const text = input.text ?? current.text;
  const status = input.status ?? current.status;
  const row = db
    .query(
      "UPDATE card_criteria SET text = ?, status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *"
    )
    .get(text, status, id) as CriterionRow;
  return toCriterion(row);
}

export function deleteCriterion(db: Database, id: CriterionId): boolean {
  const result = db.query("DELETE FROM card_criteria WHERE id = ?").run(id);
  return result.changes > 0;
}

export function reorderCriteria(
  db: Database,
  updates: Array<{ id: CriterionId; position: number }>
): void {
  const stmt = db.query(
    "UPDATE card_criteria SET position = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const tx = db.transaction(() => {
    for (const u of updates) stmt.run(u.position, u.id);
  });
  tx();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/__tests__/db/criteria.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/criteria.ts packages/core/src/__tests__/db/criteria.test.ts
git commit -m "feat(core): add criteria db layer"
```

---

### Task 5: Card schema extension + hydration + setters

**Files:**
- Modify: `packages/core/src/schemas/card.ts`
- Modify: `packages/core/src/db/cards.ts`
- Test: `packages/core/src/__tests__/db/cards-artifacts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/db/cards-artifacts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../db/schema.js";
import { createBoard } from "../../db/boards.js";
import {
  createCard,
  getCard,
  setPlanSummary,
  setCompletionSummary,
  setBlocker,
} from "../../db/cards.js";
import { seedCriteria } from "../../db/criteria.js";
import type { BoardId, CardId } from "../../types/index.js";

let db: Database;
let cardId: CardId;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  initSchema(db);
  const board = createBoard(db, { name: "T", description: "", directory: "/tmp/t" });
  const card = createCard(db, board.id as BoardId, { title: "Card", tags: [] });
  cardId = card.id as CardId;
});

describe("card artifact hydration", () => {
  it("hydrates criteria, plan_summary, completion_summary, blocker", () => {
    seedCriteria(db, cardId, ["builds", "tests pass"]);
    setPlanSummary(db, cardId, { key_files: ["a.ts"], risks: ["risk"], dependencies: [] });
    setCompletionSummary(db, cardId, "shipped X");
    setBlocker(db, cardId, { type: "git", root_cause: "conflict", resolution_route: "rebase" });

    const card = getCard(db, cardId)!;
    expect(card.criteria).toHaveLength(2);
    expect(card.plan_summary?.key_files).toEqual(["a.ts"]);
    expect(card.completion_summary).toBe("shipped X");
    expect(card.blocker?.type).toBe("git");
  });

  it("defaults artifacts to empty/null on a fresh card", () => {
    const card = getCard(db, cardId)!;
    expect(card.criteria).toEqual([]);
    expect(card.plan_summary).toBeNull();
    expect(card.completion_summary).toBeNull();
    expect(card.blocker).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/__tests__/db/cards-artifacts.test.ts`
Expected: FAIL — `setPlanSummary` not exported / `card.criteria` undefined.

- [ ] **Step 3: Extend `CardWithTagsSchema` in `packages/core/src/schemas/card.ts`**

At the top, after the existing imports, add:

```ts
import { CriterionSchema } from "./criterion.js";
import { PlanSummarySchema, BlockerSchema } from "./report.js";
```

Replace the `CardWithTagsSchema` definition (lines 42-45) with:

```ts
export const CardWithTagsSchema = CardSchema.extend({
  tags: z.array(z.string()),
  files: z.array(z.string()),
  criteria: z.array(CriterionSchema).default([]),
  plan_summary: PlanSummarySchema.nullable().default(null),
  completion_summary: z.string().nullable().default(null),
  blocker: BlockerSchema.nullable().default(null),
});
```

- [ ] **Step 4: Update `packages/core/src/db/cards.ts`**

Add imports at the top:

```ts
import * as criteriaDb from "./criteria.js";
import { PlanSummarySchema, BlockerSchema } from "../schemas/card.js";
import type { PlanSummary, Blocker } from "../types/index.js";
```

> `PlanSummarySchema` / `BlockerSchema` are re-exported from `card.js` via its imports; if not resolvable there, import them from `../schemas/report.js` instead.

Add three columns to the `CardRow` interface (after `updated_at: string;` line 32):

```ts
  plan_summary: string | null;
  completion_summary: string | null;
  blocker: string | null;
```

Add a JSON parse helper above `toCardWithTags`:

```ts
function parseJson<T>(raw: string | null, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T | null {
  if (!raw) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? (result.data as T) : null;
  } catch {
    return null;
  }
}
```

In `toCardWithTags`, add the new fields to the returned object (after `files: getFilesForCard(db, row.id),`):

```ts
    criteria: criteriaDb.getCriteria(db, row.id as CardId),
    plan_summary: parseJson<PlanSummary>(row.plan_summary, PlanSummarySchema),
    completion_summary: row.completion_summary ?? null,
    blocker: parseJson<Blocker>(row.blocker, BlockerSchema),
```

Add setter functions at the end of the file:

```ts
export function setPlanSummary(db: Database, id: CardId, summary: PlanSummary | null): void {
  db.query("UPDATE cards SET plan_summary = ?, updated_at = datetime('now') WHERE id = ?").run(
    summary ? JSON.stringify(summary) : null,
    id
  );
}

export function setCompletionSummary(db: Database, id: CardId, summary: string | null): void {
  db.query("UPDATE cards SET completion_summary = ?, updated_at = datetime('now') WHERE id = ?").run(
    summary ?? null,
    id
  );
}

export function setBlocker(db: Database, id: CardId, blocker: Blocker | null): void {
  db.query("UPDATE cards SET blocker = ?, updated_at = datetime('now') WHERE id = ?").run(
    blocker ? JSON.stringify(blocker) : null,
    id
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && bun test src/__tests__/db/cards-artifacts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Type-check the whole package**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: no errors. (This validates the Task 2 barrel export of `criteriaDb` too.)

- [ ] **Step 7: Run the full core test suite**

Run: `cd packages/core && bun test`
Expected: all tests pass (existing + new). The existing `cards.test.ts` may assert exact card object shape — if a test fails because the card now includes `criteria`/`plan_summary`/`completion_summary`/`blocker`, update those assertions to include the new fields (`criteria: []`, the rest `null`).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schemas/card.ts packages/core/src/db/cards.ts packages/core/src/__tests__/db/cards-artifacts.test.ts
git commit -m "feat(core): hydrate card proof-of-work artifacts"
```

---

## Phase 2 — Extraction pipeline, runner hooks, prompt

### Task 6: Report extraction module

**Files:**
- Create: `packages/core/src/executor/extract-report.ts`
- Test: `packages/core/src/__tests__/executor/extract-report.test.ts`

The extraction calls spawn a CLI, so tests cover the pure helpers (`parseReportJson`, `writeReportFile`) rather than the network/process call.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/executor/extract-report.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseReportJson, writeReportFile } from "../../executor/extract-report.js";
import { ExecuteReportSchema } from "../../schemas/report.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("parseReportJson", () => {
  it("parses a fenced json block", () => {
    const text = "blah blah\n```json\n{\"criteria\":[{\"id\":\"c1\",\"status\":\"pass\",\"evidence\":\"ok\"}],\"completion_summary\":\"done\",\"blocker\":null}\n```\nmore";
    const parsed = parseReportJson(text, ExecuteReportSchema);
    expect(parsed?.criteria[0].id).toBe("c1");
  });

  it("parses a bare json object", () => {
    const text = "{\"criteria\":[],\"completion_summary\":\"\",\"blocker\":null}";
    expect(parseReportJson(text, ExecuteReportSchema)).not.toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseReportJson("not json at all", ExecuteReportSchema)).toBeNull();
  });
});

describe("writeReportFile", () => {
  it("writes JSON under .glue-paste/reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "gpd-"));
    tmpDirs.push(dir);
    writeReportFile(dir, "exec123", { hello: "world" });
    const file = join(dir, ".glue-paste", "reports", "exec123.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).hello).toBe("world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/__tests__/executor/extract-report.test.ts`
Expected: FAIL — cannot find module `../../executor/extract-report.js`.

- [ ] **Step 3: Create `packages/core/src/executor/extract-report.ts`**

```ts
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { getFreshEnv } from "./fresh-env.js";
import { log } from "../logger.js";
import { PlanReportSchema, ExecuteReportSchema } from "../schemas/report.js";
import type { Criterion, ExecuteReport, FileChange, PlanReport } from "../types/index.js";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";

/** Parse a JSON object out of model output (fenced ```json block or bare object), then Zod-validate. */
export function parseReportJson<T>(
  text: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }
): T | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const result = schema.safeParse(JSON.parse(candidate));
      if (result.success) return result.data as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Persist the raw report JSON for audit/debug under <directory>/.glue-paste/reports/<executionId>.json */
export function writeReportFile(directory: string, executionId: string, data: unknown): void {
  try {
    const dir = join(resolve(directory), ".glue-paste", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${executionId}.json`), JSON.stringify(data, null, 2));
  } catch (err) {
    log.warn("extract-report", `Failed to write report file for ${executionId}:`, err);
  }
}

async function runHaiku(prompt: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["claude", "-p", prompt, "--output-format", "text", "--max-turns", "2", "--model", EXTRACT_MODEL],
      { stdout: "pipe", stderr: "pipe", env: getFreshEnv() }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log.warn("extract-report", `Haiku CLI exited with code ${exitCode}`);
      return null;
    }
    return output;
  } catch (err) {
    log.warn("extract-report", "Haiku CLI call failed:", err);
    return null;
  }
}

export async function extractPlanReport(args: {
  title: string;
  description: string;
  planOutput: string;
}): Promise<PlanReport | null> {
  const prompt = `You analyze an AI implementation PLAN and extract structure. Reply with ONLY a JSON object, no prose, matching:
{"criteria": string[], "plan_summary": {"key_files": string[], "risks": string[], "dependencies": string[]}}
- "criteria": 2-6 concrete, checkable acceptance criteria the finished work must satisfy.
- "key_files": files the plan will create or modify.
- "risks"/"dependencies": short bullet phrases (may be empty arrays).

TASK TITLE: ${args.title}
TASK DESCRIPTION: ${args.description.slice(0, 2000)}

PLAN:
${args.planOutput.slice(-6000)}`;
  const output = await runHaiku(prompt);
  if (!output) return null;
  return parseReportJson<PlanReport>(output, PlanReportSchema);
}

export async function extractExecuteReport(args: {
  title: string;
  description: string;
  criteria: Criterion[];
  output: string;
  filesChanged: FileChange[];
  exitCode: number;
}): Promise<ExecuteReport | null> {
  const criteriaList = args.criteria.map((c) => `[${c.id}] ${c.text}`).join("\n");
  const filesList = args.filesChanged.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`).join("\n") || "(none)";
  const prompt = `You verify whether an AI execution satisfied each acceptance criterion. Reply with ONLY a JSON object, no prose, matching:
{"criteria": [{"id": string, "status": "pass"|"fail", "evidence": string}], "completion_summary": string, "blocker": {"type": string, "root_cause": string, "resolution_route": string} | null}
- Return one entry per criterion id below; "evidence" cites a test result, command, or changed file (short).
- "completion_summary": one sentence on what shipped (empty if the run failed).
- "blocker": non-null ONLY if the run failed; otherwise null.

CRITERIA:
${criteriaList || "(none)"}

EXIT CODE: ${args.exitCode}
CHANGED FILES:
${filesList}

EXECUTION OUTPUT:
${args.output.slice(-6000)}`;
  const output = await runHaiku(prompt);
  if (!output) return null;
  return parseReportJson<ExecuteReport>(output, ExecuteReportSchema);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/__tests__/executor/extract-report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/extract-report.ts packages/core/src/__tests__/executor/extract-report.test.ts
git commit -m "feat(core): add report extraction module"
```

---

### Task 7: Acceptance criteria in the execute prompt

**Files:**
- Modify: `packages/core/src/executor/prompt.ts`
- Test: `packages/core/src/__tests__/executor/prompt.test.ts` (existing — add a case)

- [ ] **Step 1: Add a failing test case**

In `packages/core/src/__tests__/executor/prompt.test.ts`, add a test that builds an execute-phase prompt with criteria and asserts the section appears. Use the existing test's card/board/config fixtures as a template; the new case:

```ts
it("includes acceptance criteria in the execute prompt", () => {
  const prompt = buildPrompt({
    card: { ...baseCard },
    board: baseBoard,
    comments: [],
    config: baseConfig,
    phase: "execute",
    criteria: [
      { id: "c1", card_id: baseCard.id, text: "App builds", status: "pending", source: "ai", evidence: null, execution_id: null, position: 0, created_at: "", updated_at: "" },
    ],
  });
  expect(prompt).toContain("## Acceptance Criteria");
  expect(prompt).toContain("[c1] App builds");
});
```

> Reuse whatever fixture names the existing `prompt.test.ts` defines (`baseCard`, `baseBoard`, `baseConfig`). If they differ, mirror an existing `buildPrompt(...)` call in that file and add `criteria: [...]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/__tests__/executor/prompt.test.ts`
Expected: FAIL — prompt does not contain `## Acceptance Criteria` (and a TS error: `criteria` not on `PromptContext`).

- [ ] **Step 3: Add `criteria` to `PromptContext` and render it**

In `packages/core/src/executor/prompt.ts`, add the import:

```ts
import type { Board, CardWithTags, Comment, ConfigInput, Criterion } from "../types/index.js";
```

Add to the `PromptContext` interface:

```ts
  criteria?: Criterion[];
```

In the execute branch (the `else` after `if (phase === "plan")`), before `parts.push(\`## Instructions\`)`, add:

```ts
    if (ctx.criteria && ctx.criteria.length > 0) {
      parts.push(`## Acceptance Criteria`);
      parts.push(`Your work must satisfy each of these. Make the proof visible (run tests, show output):`);
      for (const cr of ctx.criteria) {
        parts.push(`- [${cr.id}] ${cr.text}`);
      }
      parts.push("");
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/__tests__/executor/prompt.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor/prompt.ts packages/core/src/__tests__/executor/prompt.test.ts
git commit -m "feat(core): list acceptance criteria in execute prompt"
```

---

### Task 8: Wire extraction into the runner

**Files:**
- Modify: `packages/core/src/executor/runner.ts`

This task has no new unit test (it orchestrates a live CLI call); correctness is covered by the helper tests in Task 6 plus the full suite + type-check. The extraction is wrapped in try/catch so it can never fail a card.

- [ ] **Step 1: Add imports**

In `packages/core/src/executor/runner.ts`, add:

```ts
import * as criteriaDb from "../db/criteria.js";
import { extractPlanReport, extractExecuteReport, writeReportFile } from "./extract-report.js";
import type { CriterionId } from "../types/index.js";
```

- [ ] **Step 2: Pass criteria into the execute prompt**

In `executePhase`, find the `buildPrompt({ ... })` call (around line 331). Change it to pass criteria for the execute phase:

```ts
  const prompt = buildPrompt({
    card,
    board,
    comments,
    config,
    phase,
    planOutput,
    attachmentPaths,
    criteria: phase === "execute" ? criteriaDb.getCriteria(db, card.id as CardId) : undefined,
  });
```

- [ ] **Step 3: Hoist the captured file changes**

In `executePhase`, near the top where `let attachmentPaths: string[] = [];` is declared (~line 322), add:

```ts
  let executeFilesChanged: FileChange[] = [];
```

Inside the `if (phase === "execute" && shaBefore)` block (~line 482), right after `const filesChanged = await captureFileChanges(board.directory, shaBefore);`, add:

```ts
      executeFilesChanged = filesChanged;
```

- [ ] **Step 4: Add the extraction block**

In `executePhase`, after the commits-capture block (the `if (phase === "execute" && shaBefore) { ... captureNewCommits ... }` ending ~line 530) and before the `// Add system comment with summary` block (~line 532), insert:

```ts
  // === Proof of work: extract structured artifacts (best-effort, never fails the card) ===
  try {
    if (phase === "plan" && success) {
      const report = await extractPlanReport({
        title: card.title,
        description: card.description,
        planOutput: output,
      });
      if (report) {
        criteriaDb.seedCriteria(db, card.id as CardId, report.criteria);
        cardsDb.setPlanSummary(db, card.id as CardId, report.plan_summary);
        writeReportFile(board.directory, execution.id, report);
      }
    } else if (phase === "execute") {
      const criteria = criteriaDb.getCriteria(db, card.id as CardId);
      const report = await extractExecuteReport({
        title: card.title,
        description: card.description,
        criteria,
        output,
        filesChanged: executeFilesChanged,
        exitCode,
      });
      if (report) {
        for (const r of report.criteria) {
          criteriaDb.setCriterionResult(db, r.id as CriterionId, r.status, r.evidence, execution.id as ExecutionId);
        }
        if (success) cardsDb.setCompletionSummary(db, card.id as CardId, report.completion_summary);
        cardsDb.setBlocker(db, card.id as CardId, success ? null : report.blocker);
        writeReportFile(board.directory, execution.id, report);
        const passed = report.criteria.filter((r) => r.status === "pass").length;
        if (report.criteria.length > 0) {
          const proofComment = commentsDb.addSystemComment(
            db,
            card.id as CardId,
            execution.id,
            `Proof: ${passed}/${report.criteria.length} criteria passed.`
          );
          callbacks.onCommentAdded(proofComment);
        }
      }
    }
    const refreshed = cardsDb.getCard(db, card.id as CardId);
    if (refreshed) callbacks.onCardUpdated(refreshed);
  } catch (err) {
    log.warn("runner", `Proof extraction failed for phase "${phase}":`, err);
  }
```

- [ ] **Step 5: Type-check**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full core suite**

Run: `cd packages/core && bun test`
Expected: all pass. (Runner tests mock or avoid live CLI calls; extraction's try/catch swallows the absent `claude` binary in tests, so no runner test should regress. If a runner test asserts an exact comment/`onCardUpdated` call count, update it to allow the extra best-effort `onCardUpdated`.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/executor/runner.ts
git commit -m "feat(core): extract proof-of-work after plan and execute phases"
```

---

## Phase 3 — Server API

### Task 9: Criteria CRUD routes

**Files:**
- Create: `packages/server/src/routes/criteria.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/__tests__/routes/criteria.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/routes/criteria.test.ts`. Mirror the structure of the existing `packages/server/src/__tests__/routes/commits.test.ts` for DB/app setup. Core assertions:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Database } from "bun:sqlite";
import { initSchema } from "@glue-paste-dev/core";
import { createBoard } from "@glue-paste-dev/core";
import { criteriaRoutes } from "../../routes/criteria.js";
// NOTE: match the import style used by the sibling commits.test.ts for initSchema/createBoard/createCard.
```

> The sibling tests in this folder establish the canonical way to get a test `Database`, seed a board + card, and call a Hono sub-app with `app.request(...)`. Follow that exact pattern. The behavior to assert:

1. `POST /api/criteria/card/:cardId` with `{ "text": "must build" }` → 201, body has `source: "user"`.
2. `PUT /api/criteria/:criterionId` with `{ "status": "pass" }` → 200, body `status: "pass"`.
3. `DELETE /api/criteria/:criterionId` → 200 `{ ok: true }`.
4. `POST` with `{ "text": "" }` → 400.
5. Each mutation calls the `broadcast` spy with a `card:updated` event.

```ts
describe("criteria routes", () => {
  let db: Database;
  let cardId: string;
  let events: Array<{ type: string }>;
  let app: ReturnType<typeof criteriaRoutes>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema(db);
    const board = createBoard(db, { name: "T", description: "", directory: "/tmp/t" });
    // create a card via cardsDb (import alongside createBoard following the sibling test's imports)
    // cardId = <created card>.id
    events = [];
    app = criteriaRoutes(db, (e) => events.push(e as { type: string }));
  });

  it("adds a user criterion and broadcasts", async () => {
    const res = await app.request(`/card/${cardId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "must build" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source).toBe("user");
    expect(events.some((e) => e.type === "card:updated")).toBe(true);
  });

  it("rejects empty text", async () => {
    const res = await app.request(`/card/${cardId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(res.status).toBe(400);
  });
});
```

> Complete the `cardId` setup and the PUT/DELETE cases using the sibling test's card-creation import (`cardsDb.createCard` or the named `createCard`). Keep all five behaviors above.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bunx vitest run src/__tests__/routes/criteria.test.ts`
Expected: FAIL — cannot find module `../../routes/criteria.js`.

- [ ] **Step 3: Create `packages/server/src/routes/criteria.ts`**

```ts
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  criteriaDb,
  cardsDb,
  CreateCriterionSchema,
  UpdateCriterionSchema,
  ReorderCriteriaSchema,
} from "@glue-paste-dev/core";
import type { CardId, CriterionId } from "@glue-paste-dev/core";

export function criteriaRoutes(db: Database, broadcast: (event: unknown) => void) {
  const app = new Hono();

  function broadcastCard(cardId: CardId): void {
    const card = cardsDb.getCard(db, cardId);
    if (card) broadcast({ type: "card:updated", payload: card });
  }

  // POST /api/criteria/card/:cardId — add a manual criterion
  app.post("/card/:cardId", async (c) => {
    const body = await c.req.json();
    const parsed = CreateCriterionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const cardId = c.req.param("cardId") as CardId;
    const criterion = criteriaDb.createCriterion(db, cardId, parsed.data.text);
    broadcastCard(cardId);
    return c.json(criterion, 201);
  });

  // PUT /api/criteria/:criterionId — edit text and/or status
  app.put("/:criterionId", async (c) => {
    const body = await c.req.json();
    const parsed = UpdateCriterionSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const id = c.req.param("criterionId") as CriterionId;
    const existing = criteriaDb.getCriterion(db, id);
    if (!existing) return c.json({ error: "Criterion not found" }, 404);
    const criterion = criteriaDb.updateCriterion(db, id, parsed.data);
    broadcastCard(existing.card_id as CardId);
    return c.json(criterion);
  });

  // DELETE /api/criteria/:criterionId
  app.delete("/:criterionId", (c) => {
    const id = c.req.param("criterionId") as CriterionId;
    const existing = criteriaDb.getCriterion(db, id);
    if (!existing) return c.json({ error: "Criterion not found" }, 404);
    criteriaDb.deleteCriterion(db, id);
    broadcastCard(existing.card_id as CardId);
    return c.json({ ok: true });
  });

  // PATCH /api/criteria/reorder
  app.patch("/reorder", async (c) => {
    const body = await c.req.json();
    const parsed = ReorderCriteriaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    criteriaDb.reorderCriteria(db, parsed.data);
    const first = parsed.data[0];
    if (first) {
      const criterion = criteriaDb.getCriterion(db, first.id as CriterionId);
      if (criterion) broadcastCard(criterion.card_id as CardId);
    }
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: Register the routes in `packages/server/src/index.ts`**

Add the import alongside the other route imports:

```ts
import { criteriaRoutes } from "./routes/criteria.js";
```

Add the route registration alongside the others (after the `commitRoutes` line ~124):

```ts
app.route("/api/criteria", criteriaRoutes(db, broadcast));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && bunx vitest run src/__tests__/routes/criteria.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + full server suite**

Run: `cd packages/server && bunx tsc --noEmit && bunx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/criteria.ts packages/server/src/index.ts packages/server/src/__tests__/routes/criteria.test.ts
git commit -m "feat(server): add criteria CRUD routes"
```

---

## Phase 4 — Dashboard UI

### Task 10: Criteria API client

**Files:**
- Modify: `packages/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add a `criteria` API object**

In `packages/dashboard/src/lib/api.ts`, after the `cards` export block, add:

```ts
// Criteria
export const criteria = {
  add: (cardId: string, text: string) =>
    request<Criterion>(`/criteria/card/${cardId}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  update: (id: string, data: { text?: string; status?: "pending" | "pass" | "fail" }) =>
    request<Criterion>(`/criteria/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/criteria/${id}`, { method: "DELETE" }),
  reorder: (updates: Array<{ id: string; position: number }>) =>
    request<{ ok: boolean }>("/criteria/reorder", {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
};
```

Ensure `Criterion` is imported/available. This file already uses core types like `CardWithTags`; add `Criterion` (and `PlanSummary`, `Blocker` if not already) to wherever those types are imported from `@glue-paste-dev/core`. If the file relies on global ambient types, add:

```ts
import type { Criterion } from "@glue-paste-dev/core";
```

- [ ] **Step 2: Type-check**

Run: `cd packages/dashboard && bunx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/lib/api.ts
git commit -m "feat(dashboard): add criteria api client"
```

---

### Task 11: PlanPanel component

**Files:**
- Create: `packages/dashboard/src/components/board/PlanPanel.tsx`
- Test: `packages/dashboard/src/components/board/PlanPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/board/PlanPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanPanel } from "./PlanPanel";

describe("PlanPanel", () => {
  it("renders key files, risks, dependencies", () => {
    render(
      <PlanPanel
        planSummary={{ key_files: ["src/a.ts"], risks: ["flaky test"], dependencies: ["zod"] }}
      />
    );
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("flaky test")).toBeInTheDocument();
    expect(screen.getByText("zod")).toBeInTheDocument();
  });

  it("renders an empty state when no plan summary", () => {
    render(<PlanPanel planSummary={null} />);
    expect(screen.getByText(/no plan summary yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && bunx vitest run src/components/board/PlanPanel.test.tsx`
Expected: FAIL — cannot find module `./PlanPanel`.

- [ ] **Step 3: Create `packages/dashboard/src/components/board/PlanPanel.tsx`**

```tsx
import type { PlanSummary } from "@glue-paste-dev/core";

interface PlanPanelProps {
  planSummary: PlanSummary | null;
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</h4>
      <ul className="list-disc pl-5 space-y-0.5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanPanel({ planSummary }: PlanPanelProps) {
  if (!planSummary) {
    return <p className="text-sm text-muted-foreground p-4">No plan summary yet. It is generated after the plan phase runs.</p>;
  }
  return (
    <div className="p-4">
      <Section title="Key Files" items={planSummary.key_files} />
      <Section title="Risks" items={planSummary.risks} />
      <Section title="Dependencies" items={planSummary.dependencies} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && bunx vitest run src/components/board/PlanPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/board/PlanPanel.tsx packages/dashboard/src/components/board/PlanPanel.test.tsx
git commit -m "feat(dashboard): add PlanPanel component"
```

---

### Task 12: CriteriaList component

**Files:**
- Create: `packages/dashboard/src/components/board/CriteriaList.tsx`
- Test: `packages/dashboard/src/components/board/CriteriaList.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/board/CriteriaList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CriteriaList } from "./CriteriaList";
import type { Criterion } from "@glue-paste-dev/core";

const make = (over: Partial<Criterion>): Criterion => ({
  id: "c1",
  card_id: "card1",
  text: "App builds",
  status: "pending",
  source: "ai",
  evidence: null,
  execution_id: null,
  position: 0,
  created_at: "",
  updated_at: "",
  ...over,
}) as Criterion;

describe("CriteriaList", () => {
  it("renders criteria with status and evidence", () => {
    render(
      <CriteriaList
        criteria={[make({ status: "pass", evidence: "tests green" })]}
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onJumpToExecution={vi.fn()}
      />
    );
    expect(screen.getByText("App builds")).toBeInTheDocument();
    expect(screen.getByText("tests green")).toBeInTheDocument();
  });

  it("calls onRemove when delete clicked", () => {
    const onRemove = vi.fn();
    render(
      <CriteriaList criteria={[make({})]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={onRemove} onJumpToExecution={vi.fn()} />
    );
    fireEvent.click(screen.getByLabelText("Remove criterion"));
    expect(onRemove).toHaveBeenCalledWith("c1");
  });

  it("shows an empty state with no criteria", () => {
    render(<CriteriaList criteria={[]} onAdd={vi.fn()} onUpdate={vi.fn()} onRemove={vi.fn()} onJumpToExecution={vi.fn()} />);
    expect(screen.getByText(/no criteria yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && bunx vitest run src/components/board/CriteriaList.test.tsx`
Expected: FAIL — cannot find module `./CriteriaList`.

- [ ] **Step 3: Create `packages/dashboard/src/components/board/CriteriaList.tsx`**

```tsx
import { useState } from "react";
import type { Criterion } from "@glue-paste-dev/core";

interface CriteriaListProps {
  criteria: Criterion[];
  onAdd: (text: string) => void;
  onUpdate: (id: string, data: { text?: string; status?: "pending" | "pass" | "fail" }) => void;
  onRemove: (id: string) => void;
  onJumpToExecution?: (executionId: string) => void;
}

const STATUS_LABEL: Record<string, string> = { pending: "Pending", pass: "Pass", fail: "Fail" };
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  pass: "bg-green-500/15 text-green-600 dark:text-green-400",
  fail: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function nextStatus(s: Criterion["status"]): "pending" | "pass" | "fail" {
  return s === "pending" ? "pass" : s === "pass" ? "fail" : "pending";
}

export function CriteriaList({ criteria, onAdd, onUpdate, onRemove, onJumpToExecution }: CriteriaListProps) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft("");
  };

  return (
    <div className="p-4 space-y-3">
      {criteria.length === 0 ? (
        <p className="text-sm text-muted-foreground">No criteria yet. They are generated after the plan phase, or add one below.</p>
      ) : (
        <ul className="space-y-2">
          {criteria.map((c) => (
            <li key={c.id} className="rounded border border-border p-2">
              <div className="flex items-start gap-2">
                <button
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[c.status]}`}
                  onClick={() => onUpdate(c.id, { status: nextStatus(c.status) })}
                  title="Cycle status"
                >
                  {STATUS_LABEL[c.status]}
                </button>
                <span className="flex-1 text-sm">{c.text}</span>
                <button
                  aria-label="Remove criterion"
                  className="shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => onRemove(c.id)}
                >
                  ×
                </button>
              </div>
              {c.evidence && (
                <button
                  className="mt-1 block w-full text-left text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => c.execution_id && onJumpToExecution?.(c.execution_id)}
                  title={c.execution_id ? "Jump to terminal output" : undefined}
                >
                  {c.evidence}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="Add a criterion…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={submit}>
          Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && bunx vitest run src/components/board/CriteriaList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/board/CriteriaList.tsx packages/dashboard/src/components/board/CriteriaList.test.tsx
git commit -m "feat(dashboard): add CriteriaList component"
```

---

### Task 13: Integrate tabs + banner into CardDialog

**Files:**
- Modify: `packages/dashboard/src/components/board/CardDialog.tsx`

This wires the two new components into the dialog as top-level tabs and adds the completion/blocker banner. Read the file first to locate the current tab state and the General/Conversation tab markup (the Conversation tab renders `TerminalStream` and `ActivityList` around lines 1080-1138, and there is a tab-selection state variable near the top).

- [ ] **Step 1: Locate the tab state and the card object**

Read `packages/dashboard/src/components/board/CardDialog.tsx`. Identify:
- the state controlling the active top-level tab (a `useState` holding `"general" | "conversation"` or similar);
- the variable holding the loaded card (with `.criteria`, `.plan_summary`, `.completion_summary`, `.blocker` now available);
- the existing `scrollToExecution` ref used by `TerminalStream` (the Conversation tab already calls it via `onJumpToExecution`).

- [ ] **Step 2: Extend the tab union and tab bar**

Add `"plan"` and `"criteria"` to the active-tab state union/type. In the tab bar markup (where the "General" and "Conversation" tab buttons are rendered), add two buttons between them following the exact same className/onClick pattern as the existing tab buttons:

```tsx
<button
  className={/* same pattern as existing tab buttons */ tabButtonClass(activeTab === "plan")}
  onClick={() => setActiveTab("plan")}
>
  Plan
</button>
<button
  className={tabButtonClass(activeTab === "criteria")}
  onClick={() => setActiveTab("criteria")}
>
  Criteria &amp; Proof
  {card.criteria.length > 0 && (
    <span className="ml-1 text-xs text-muted-foreground">
      {card.criteria.filter((c) => c.status === "pass").length}/{card.criteria.length}
    </span>
  )}
</button>
```

> Use the project's existing helper/inline expression for the active/inactive button classes (shown above as `tabButtonClass(...)` — replace with whatever the file already uses for the General/Conversation buttons).

- [ ] **Step 3: Add the imports**

At the top of `CardDialog.tsx`:

```tsx
import { PlanPanel } from "./PlanPanel";
import { CriteriaList } from "./CriteriaList";
import { criteria as criteriaApi } from "@/lib/api";
```

- [ ] **Step 4: Render the new tab bodies**

Where tab bodies are rendered (next to the existing `{activeTab === "conversation" && (...)}` block), add:

```tsx
{activeTab === "plan" && <PlanPanel planSummary={card.plan_summary} />}

{activeTab === "criteria" && (
  <CriteriaList
    criteria={card.criteria}
    onAdd={(text) => void criteriaApi.add(card.id, text)}
    onUpdate={(id, data) => void criteriaApi.update(id, data)}
    onRemove={(id) => void criteriaApi.remove(id)}
    onJumpToExecution={(executionId) => {
      setActiveTab("conversation");
      // reuse the existing terminal scroll mechanism the Conversation tab already wires up
      scrollToExecution(executionId);
    }}
  />
)}
```

> Mutations rely on the existing `card:updated` WebSocket flow to refresh the dialog (the dialog already re-renders from card updates, as the General tab does today). If the dialog keeps a local copy of the card that is not updated by WS, call the dialog's existing card-refresh function after each mutation (the same one used after editing other card fields).

- [ ] **Step 5: Add the completion/blocker banner**

Near the top of the dialog body (above the tab bar), add:

```tsx
{card.blocker && (
  <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
    <span className="font-semibold text-red-600 dark:text-red-400">Blocked ({card.blocker.type}):</span>{" "}
    {card.blocker.root_cause} — <span className="italic">{card.blocker.resolution_route}</span>
  </div>
)}
{!card.blocker && card.completion_summary && (
  <div className="mb-2 rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
    <span className="font-semibold text-green-600 dark:text-green-400">Done:</span> {card.completion_summary}
  </div>
)}
```

- [ ] **Step 6: Type-check**

Run: `cd packages/dashboard && bunx tsc -b`
Expected: no errors.

- [ ] **Step 7: Run existing CardDialog tests**

Run: `cd packages/dashboard && bunx vitest run src/components/board/CardDialog.test.tsx src/components/board/CardDialog.comment.test.tsx`
Expected: PASS. If a test renders the dialog with a card fixture that lacks the new fields, update the fixture to include `criteria: []`, `plan_summary: null`, `completion_summary: null`, `blocker: null`.

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/components/board/CardDialog.tsx
git commit -m "feat(dashboard): add Plan and Criteria tabs + status banner to CardDialog"
```

---

### Task 14: Criteria progress badge on KanbanCard

**Files:**
- Modify: `packages/dashboard/src/components/board/KanbanCard.tsx`

- [ ] **Step 1: Read KanbanCard and locate the card metadata footer**

Read `packages/dashboard/src/components/board/KanbanCard.tsx`. Find where per-card metadata (tags, status indicators) is rendered. The card prop is a `CardWithTags` and now exposes `criteria` and `blocker`.

- [ ] **Step 2: Add the badge**

In the metadata row, add:

```tsx
{card.criteria.length > 0 && (
  <span
    className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
    title="Acceptance criteria passed"
  >
    {card.criteria.filter((c) => c.status === "pass").length}/{card.criteria.length} ✓
  </span>
)}
{card.blocker && (
  <span className="text-xs text-red-500" title={`Blocked: ${card.blocker.root_cause}`}>
    ⚠ blocked
  </span>
)}
```

- [ ] **Step 3: Type-check**

Run: `cd packages/dashboard && bunx tsc -b`
Expected: no errors.

- [ ] **Step 4: Run the full dashboard suite**

Run: `cd packages/dashboard && bunx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/board/KanbanCard.tsx
git commit -m "feat(dashboard): show criteria progress + blocker badge on cards"
```

---

## Final verification

- [ ] **Step 1: Type-check all packages**

```bash
cd packages/core && bunx tsc --noEmit && \
cd ../server && bunx tsc --noEmit && \
cd ../dashboard && bunx tsc -b && \
cd ../cli && bunx tsc --noEmit
```
Expected: no errors in any package.

- [ ] **Step 2: Run all test suites**

```bash
cd packages/core && bun test && \
cd ../server && bunx vitest run && \
cd ../dashboard && bunx vitest run
```
Expected: all green.

- [ ] **Step 3: Manual smoke (optional, via the run skill)**

Build/run the app, create a card, queue it, and confirm after execution the card shows criteria with pass/fail, a plan summary, and a completion or blocker banner; confirm `.glue-paste/reports/<executionId>.json` files appear in the target repo.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- #1 Acceptance criteria (AI-seeded + user-editable) → Tasks 1,3,4 (schema/db), 6,8 (AI seeding), 9,10,12,13 (user edit). ✓
- #2 Proof of work (self-reported per-criterion verdict + evidence) → Tasks 6,8 (extraction + verdict upsert), 12,13 (display). ✓
- #4 Structured plan summary → Tasks 1,5 (schema/column), 6,8 (extraction), 11,13 (display). ✓
- #5 Blocker analysis → Tasks 1,5 (schema/column), 6,8 (extraction), 13,14 (display). ✓
- #6 Completion summary → Tasks 1,5, 6,8, 13,14. ✓
- Extraction writes `.glue-paste/reports/<executionId>.json` (option A: server/runner writes from model output) → Task 6 (`writeReportFile`), Task 8 (called in runner). ✓
- New top-level tabs + banner → Task 13. ✓
- Review-gate explicitly deferred → not in any task (correct). ✓

**Type consistency:** `seedCriteria`, `setCriterionResult`, `getCriterion`, `createCriterion`, `updateCriterion`, `deleteCriterion`, `reorderCriteria` (criteria db); `setPlanSummary`, `setCompletionSummary`, `setBlocker` (cards db); `extractPlanReport`, `extractExecuteReport`, `parseReportJson`, `writeReportFile` (extractor); `criteriaApi.add/update/remove/reorder` (dashboard) — names used identically across tasks. `PlanReport`/`ExecuteReport`/`PlanSummary`/`Blocker`/`Criterion`/`CriterionId` types consistent.

**Placeholder scan:** No TBD/TODO. Task 9 and Task 13 intentionally reference sibling-file patterns (test setup imports; CardDialog tab-button class helper) because exact local identifiers must be read from the file at execution time — concrete code blocks are provided for all new logic.

**Circular-import note:** `criterion.ts` uses `z.string()` for `card_id` (not `CardIdSchema`) so `card.ts` can import `CriterionSchema` without a cycle. Verified one-directional: `card.ts → criterion.ts/report.ts`, and `db/cards.ts → db/criteria.ts`.
