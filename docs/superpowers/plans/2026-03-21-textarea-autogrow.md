# Textarea Auto-Grow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make textarea fields auto-grow with content, with the description field starting at 3 rows minimum.

**Architecture:** Replace the native `<textarea>` in the shared `Textarea` UI component with `TextareaAutosize` from `react-textarea-autosize`. This adds `minRows`/`maxRows` prop support to all consumers. Description fields get `minRows={3}`; the CoPlanSidebar chat input keeps its compact single-row start.

**Tech Stack:** React 19, `react-textarea-autosize`, Tailwind v4, TypeScript

---

## File Map

| File | Change |
|---|---|
| `packages/dashboard/package.json` | Add `react-textarea-autosize` dependency |
| `packages/dashboard/src/components/ui/textarea.tsx` | Swap `<textarea>` → `<TextareaAutosize>`, add `minRows`/`maxRows` props, remove hardcoded `min-h-[80px]` |
| `packages/dashboard/src/components/board/CardDialog.tsx` | Add `minRows={3}`, remove `min-h-[120px]` className on description field |
| `packages/dashboard/src/components/board/BoardSettingsDialog.tsx` | Add `minRows={3}` to project description field |
| `packages/dashboard/src/pages/Home.tsx` | Add `minRows={3}` to project description field |
| `packages/dashboard/src/components/board/CoPlanSidebar.tsx` | Change `rows={1}` → `minRows={1}`, add `maxRows={5}`, remove `max-h-[120px]` from className |

---

### Task 1: Install `react-textarea-autosize`

**Files:**
- Modify: `packages/dashboard/package.json`

- [ ] **Step 1: Install the package**

```bash
cd packages/dashboard && bun add react-textarea-autosize
```

Expected: package added to `dependencies` in `package.json`.

- [ ] **Step 2: Verify types are included**

`react-textarea-autosize` ships its own types — no `@types/` package needed. Confirm by checking:

```bash
ls packages/dashboard/node_modules/react-textarea-autosize/dist/*.d.ts
```

Expected: `.d.ts` files present.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/package.json bun.lock
git commit -m "chore: add react-textarea-autosize dependency"
```

---

### Task 2: Update base `Textarea` component

**Files:**
- Modify: `packages/dashboard/src/components/ui/textarea.tsx`

Current file swaps in a plain `<textarea>`. We replace it with `TextareaAutosize` and extend the props type to expose `minRows`/`maxRows`.

- [ ] **Step 1: Rewrite `textarea.tsx`**

```tsx
import * as React from "react"
import TextareaAutosize from "react-textarea-autosize"
import { cn } from "@/lib/utils"

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  minRows?: number
  maxRows?: number
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <TextareaAutosize
        className={cn(
          "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = "Textarea"

export { Textarea }
export type { TextareaProps }
```

Key changes vs. original:
- Import `TextareaAutosize` instead of using native `<textarea>`
- `TextareaProps` extends HTML attrs and adds `minRows`/`maxRows`
- Removed `min-h-[80px]` from base className — height is now controlled by `minRows`/content

- [ ] **Step 2: Run TypeScript check**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/components/ui/textarea.tsx
git commit -m "feat: replace Textarea base component with react-textarea-autosize"
```

---

### Task 3: Apply `minRows={3}` to description field in CardDialog

**Files:**
- Modify: `packages/dashboard/src/components/board/CardDialog.tsx` (line ~209–215)

The description `<Textarea>` currently has `className="min-h-[120px]"`. Replace with `minRows={3}`.

- [ ] **Step 1: Update the description Textarea in CardDialog**

Find this block (~line 209):
```tsx
<Textarea
  placeholder="Describe what needs to be done..."
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  className="min-h-[120px]"
  autoFocus={!isEditing}
/>
```

Change to:
```tsx
<Textarea
  placeholder="Describe what needs to be done..."
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  minRows={3}
  autoFocus={!isEditing}
/>
```

(Remove `className="min-h-[120px]"` — `minRows={3}` replaces it.)

- [ ] **Step 2: Run TypeScript check**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/components/board/CardDialog.tsx
git commit -m "feat: auto-grow description textarea in CardDialog, min 3 rows"
```

---

### Task 4: Apply `minRows={3}` to description fields in BoardSettingsDialog and Home

**Files:**
- Modify: `packages/dashboard/src/components/board/BoardSettingsDialog.tsx` (~line 183)
- Modify: `packages/dashboard/src/pages/Home.tsx` (~line 156)

Both have project description `<Textarea>` fields with no explicit height — they'd shrink to 1 row with auto-sizing. Add `minRows={3}` to match the card description UX.

- [ ] **Step 1: Update BoardSettingsDialog**

Find the description `<Textarea>` (around line 183):
```tsx
<Textarea
  placeholder="What is this project about?"
  value={description}
  onChange={(e) => setDescription(e.target.value)}
```

Add `minRows={3}`:
```tsx
<Textarea
  placeholder="What is this project about?"
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  minRows={3}
```

- [ ] **Step 2: Update Home.tsx**

Find the description `<Textarea>` (around line 156):
```tsx
<Textarea
  placeholder="What this project is about..."
  value={description}
  onChange={(e) => setDescription(e.target.value)}
```

Add `minRows={3}`:
```tsx
<Textarea
  placeholder="What this project is about..."
  value={description}
  onChange={(e) => setDescription(e.target.value)}
  minRows={3}
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/board/BoardSettingsDialog.tsx packages/dashboard/src/pages/Home.tsx
git commit -m "feat: auto-grow description textareas in BoardSettingsDialog and Home"
```

---

### Task 5: Update CoPlanSidebar chat input

**Files:**
- Modify: `packages/dashboard/src/components/board/CoPlanSidebar.tsx` (~line 173–182)

The chat input currently uses `rows={1}`, `min-h-[40px]`, and `max-h-[120px]`. With auto-sizing:
- `rows={1}` → `minRows={1}` (keeps compact initial state)
- `max-h-[120px]` can be replaced with `maxRows={5}` (cleaner, no manual pixel math)
- Remove `resize-none` — unnecessary since `TextareaAutosize` handles resizing

- [ ] **Step 1: Update CoPlanSidebar Textarea**

Find (~line 173):
```tsx
<Textarea
  ref={textareaRef}
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={handleKeyDown}
  placeholder={mode === "plan" ? "Discuss the plan..." : "Describe what to implement..."}
  className="min-h-[40px] max-h-[120px] resize-none text-sm"
  rows={1}
  disabled={isStreaming}
/>
```

Change to:
```tsx
<Textarea
  ref={textareaRef}
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={handleKeyDown}
  placeholder={mode === "plan" ? "Discuss the plan..." : "Describe what to implement..."}
  className="text-sm"
  minRows={1}
  maxRows={5}
  disabled={isStreaming}
/>
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 3: Run dashboard tests**

```bash
cd packages/dashboard && bunx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/board/CoPlanSidebar.tsx
git commit -m "feat: auto-grow CoPlanSidebar chat input, min 1 row max 5 rows"
```

---

### Task 6: Final verification and push

- [ ] **Step 1: Full type check**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 2: Run all dashboard tests**

```bash
cd packages/dashboard && bunx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Push to remote**

```bash
git push
```
