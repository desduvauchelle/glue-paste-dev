# Design: Structured Card Artifacts & Proof of Work

**Date:** 2026-05-22
**Status:** Approved (pending spec review)

## Background

Inspired by [phodal/routa](https://github.com/phodal/routa), where a card accumulates
structured artifacts as it moves across Kanban lanes (story → plan → evidence → verdict →
completion), and where a verification gate treats *evidence* as mandatory. Today our cards
capture rich raw material (execution output, commits, files changed) but bind none of it to
explicit, checkable claims. This design adds a structured artifact layer so a card carries
**acceptance criteria**, **per-criterion proof of work**, a **structured plan summary**, a
**blocker analysis**, and a **completion summary**.

## Scope

Delivers 5 of 6 improvements. The independent **review-gate** (#3 — a second AI pass that
re-verifies each criterion and hard-blocks `done`) is intentionally **deferred**. The schema
is designed so the gate slots in later (add a `review` execution phase; make `done` require
all criteria `pass`).

In scope:
1. Acceptance criteria — AI-seeded during plan, user-editable. (#1)
2. Proof of work — per-criterion verdict + evidence, self-reported via a cheap extraction call. (#2)
3. Structured plan summary — key files, risks, dependencies. (#4)
4. Blocker analysis — type, root cause, resolution route, on failure. (#5)
5. Completion summary — what shipped + key evidence, on success. (#6)

Out of scope (this plan): independent review-gate (#3), hard gating of `done`.

## Key decisions (from brainstorming)

- **Criteria source:** AI seeds during plan phase; user can add/edit/remove anytime.
- **Proof source:** executor self-reports; review-gate opt-in later.
- **Extraction mechanism:** a secondary cheap-model (Claude Haiku) one-shot call after each
  phase. The call returns JSON on **stdout**; the server validates it (Zod), writes the raw
  JSON to `.glue-paste/reports/<executionId>.json` as a durable audit artifact, and persists
  parsed values to the DB (option A). The agent does **not** write the file itself.
- **UI placement:** new top-level tabs in CardDialog (`Plan`, `Criteria & Proof`); completion
  summary / blocker shown as a banner.
- **No hard gate now:** criteria are informational; card status stays driven by the existing
  exit-code + no-changes logic.

## Architecture

### Data model

**New table `card_criteria`** (follows `card_tags` / `card_files` conventions):

| column | type | notes |
|---|---|---|
| `id` | TEXT PK `DEFAULT (lower(hex(randomblob(8))))` | |
| `card_id` | TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE | |
| `text` | TEXT NOT NULL | criterion statement |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','pass','fail')) | |
| `source` | TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai','user')) | |
| `evidence` | TEXT DEFAULT NULL | proof text: test cmd + output excerpt / changed file |
| `execution_id` | TEXT REFERENCES executions(id) ON DELETE SET NULL | run that verified it |
| `position` | INTEGER NOT NULL DEFAULT 0 | display order |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) | |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) | |

Index: `idx_card_criteria_card_id ON card_criteria(card_id)`.

The criterion row **is** the proof unit: `status` + `evidence` + `execution_id` together are the
proof of work. No separate evidence table (YAGNI).

**New columns on `cards`** (JSON-encoded text, added via the existing idempotent
`ALTER TABLE ... ` try/catch migration pattern in `initSchema`):

- `plan_summary` TEXT DEFAULT NULL — JSON `{ key_files: string[], risks: string[], dependencies: string[] }`
- `completion_summary` TEXT DEFAULT NULL — plain string: what shipped + key evidence
- `blocker` TEXT DEFAULT NULL — JSON `{ type: string, root_cause: string, resolution_route: string }`

`blocker` is set when an execute phase fails and cleared when it succeeds.

**Report file:** `.glue-paste/reports/<executionId>.json` holds the full raw extraction output
for audit/debug. `.glue-paste/` is already gitignored.

### Schemas (`packages/core/src/schemas`)

- `criterion.ts` — `CriterionSchema`, `CreateCriterionSchema`, `UpdateCriterionSchema`.
- `report.ts` — `PlanSummarySchema`, `BlockerSchema`, `PlanReportSchema` (`{ criteria, plan_summary }`),
  `ExecuteReportSchema` (`{ criteria: {id,status,evidence}[], completion_summary, blocker|null }`).
- Extend `card.ts` `CardWithTagsSchema` with `criteria: Criterion[]`, `plan_summary`,
  `completion_summary`, `blocker` (parsed objects).

### Hydration & realtime

`criteria[]` and the parsed card fields are folded into `CardWithTags` exactly like `tags` and
`files` today. The existing `card:updated` WS event therefore carries the full artifact set — no
new WS event type is required.

### DB layer (`packages/core/src/db`)

- New `criteria.ts`: `getCriteria(db, cardId)`, `replaceCriteria(db, cardId, criteria)` (used by
  AI seeding), `upsertCriterionResult(db, criterionId, {status, evidence, executionId})`,
  `createCriterion` / `updateCriterion` / `deleteCriterion` / `reorderCriteria` (manual user CRUD).
- Extend `cards.ts`: setters for `plan_summary` / `completion_summary` / `blocker`, and hydrate
  the new fields + criteria in `getCard` / list queries.

### Extraction pipeline (`packages/core/src/executor/extract-report.ts`)

Mirrors `generate-title.ts`: a cheap one-shot `claude -p <prompt> --output-format text
--model claude-haiku-4-5-20251001` call (model overridable via config), output captured from
stdout. Degrades gracefully (logs + returns null) on any failure — never breaks card execution.

Two modes:

- **plan mode** — input: card title/description + plan output. Returns `PlanReport`
  (`criteria[]` + `plan_summary`). Used to seed AI criteria and the plan summary.
- **execute mode** — input: card + current criteria + execute output tail + changed files +
  exit code. Returns `ExecuteReport` (`criteria` verdicts + evidence, `completion_summary`,
  `blocker|null`).

The function returns the parsed object. The **caller** (runner) is responsible for writing the
raw JSON to `.glue-paste/reports/<executionId>.json` and persisting to the DB.

If the plan phase is skipped (`plan_thinking === null`), criteria are generated from the card
description by a plan-mode extraction at the start of the execute phase.

### Runner hooks (`packages/core/src/executor/runner.ts`)

- **After plan success** (after `executePhase` returns success, ~line 161): run plan-mode
  extraction → `replaceCriteria` (source `ai`) + set `plan_summary` → write report file →
  emit `card:updated`.
- **After execute completes** (in `executePhase`, before the summary comment ~line 532): run
  execute-mode extraction → `upsertCriterionResult` per criterion + set `completion_summary`
  (on success) or `blocker` (on failure) → write report file → emit `card:updated`. Add a
  system comment, e.g. `Proof: 4/5 criteria passed.`

All extraction is best-effort: a thrown error or null result is logged and skipped; card status
and existing behavior are unaffected.

### Prompt change (`packages/core/src/executor/prompt.ts`)

The execute prompt gains an `## Acceptance Criteria` section listing the criteria the agent must
satisfy, so the agent's output contains the proof the extractor harvests. Plan prompt is
unchanged (criteria are derived from plan output by extraction).

### Server API (`packages/server`)

- Card GET responses include the new fields + `criteria[]` (via hydration).
- Manual criterion CRUD routes under the existing card routes: add / edit / remove / reorder.
- Integration tests with the Hono test client.

### Dashboard UI (`packages/dashboard`)

- `CardDialog.tsx`: top-level tabs become **General · Plan · Criteria & Proof · Conversation**.
  A banner at the top of the dialog shows `completion_summary` (green, when done) or `blocker`
  (red, when failed).
- New `PlanPanel.tsx` — renders `plan_summary` (key files, risks, dependencies).
- New `CriteriaList.tsx` — each criterion: status badge (pending/pass/fail), text, expandable
  evidence, and add/edit/remove controls. Clicking a criterion's evidence jumps to the Terminal
  tab and scrolls to its `execution_id` (reuses `TerminalStream`'s `scrollToExecution`).
- `KanbanCard`: a small progress badge (`3/5 ✓`) plus a blocker icon.

## Error handling

- Extraction never throws into the runner; failures log and skip, leaving prior artifact state intact.
- `ReportSchema` validation rejects malformed model output → treated as a failed extraction (skip).
- JSON columns are parsed defensively on hydration; a parse error yields `null` for that field.
- Manual criterion CRUD validates input with Zod and returns 4xx on bad payloads.

## Testing

- **core (`bun test`)**: criteria DB CRUD + result upsert; card hydration of new fields;
  `extract-report` JSON parsing/validation (success + malformed + empty); runner emits criteria
  after plan/execute (mock the cheap call); prompt includes criteria section.
- **server (`vitest run`)**: criterion CRUD routes; card GET returns artifacts.
- **dashboard (`vitest run`)**: `CriteriaList` renders statuses + edit; `PlanPanel` renders
  summary; banner shows completion/blocker; KanbanCard progress badge.
- Type-check every package after each phase (`tsc --noEmit` / `tsc -b`).

## Implementation phases

1. **Schema + DB + Zod schemas** — `card_criteria` table, card columns, `criterion.ts` /
   `report.ts`, `db/criteria.ts`, card hydration; core tests.
2. **Extraction + runner + prompt** — `extract-report.ts`, runner hooks (plan + execute),
   report-file writing, `## Acceptance Criteria` prompt section; core tests.
3. **Server API** — criterion CRUD routes + hydrated card GET; integration tests.
4. **Dashboard UI** — Plan tab, Criteria & Proof tab, banner, PlanPanel, CriteriaList,
   KanbanCard badge; component tests.

## Future work (deferred)

- **Review-gate (#3):** add a `review` value to the execution `phase` enum; a second cheap/full
  AI pass independently re-verifies each criterion and writes findings; making `done` require
  all criteria `pass` becomes an opt-in per-card toggle.
