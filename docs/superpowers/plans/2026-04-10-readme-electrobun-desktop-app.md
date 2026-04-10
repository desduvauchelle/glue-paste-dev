# README Electrobun Desktop App Documentation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comprehensive Desktop App section to README.md covering install, dev, and build workflows for the Electrobun desktop wrapper.

**Architecture:** README.md currently has no desktop app section. The `packages/electron` directory contains the desktop app (currently Electron-based; the migration plan `2026-04-10-electrobun-desktop-app.md` renames it to `packages/electrobun`). This plan documents the Electrobun app — if the migration plan has not been executed yet, run it first (`docs/superpowers/plans/2026-04-10-electrobun-desktop-app.md`).

**Tech Stack:** Markdown, bash

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `README.md` | Add Desktop App section + update Architecture table |

---

### Task 1: Add Desktop App section to README.md

**Files:**
- Modify: `README.md`

The current README has no mention of the desktop app at all. This task adds a full Desktop App section and an Architecture table row for `packages/electrobun`.

- [ ] **Step 1: Insert the Desktop App section**

In `README.md`, find `## Usage` and insert the Desktop App section before it.

- [ ] **Step 2: Update the Architecture table**

Add `packages/electrobun` row after `packages/cli`.

- [ ] **Step 3: Verify markdown**

No broken fences, correct section order, 5 rows in Architecture table.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add Desktop App section to README for Electrobun wrapper"
```

---

## Notes for executor

- If `packages/electrobun` does not exist yet, run `docs/superpowers/plans/2026-04-10-electrobun-desktop-app.md` first.
- The install script URL references `desduvauchelle/glue-paste-dev` — update if repo slug differs.
