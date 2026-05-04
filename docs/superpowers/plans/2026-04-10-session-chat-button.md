# Session Chat Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Chat" button to the CardDialog activity box that opens an inline panel letting the user converse with the AI using the same session as the running plan/execute phases.

**Architecture:** A chat panel renders inline below the activity list when toggled open. Sending a message calls `POST /api/cards/:cardId/chat`, which runs `runChat()` in core — already wired to resume the last execution session. Streaming output is shown live in the panel via `chat:output` WS events; the final AI comment appears in the activity list via the existing `comment:added` flow. The WS event schema in core needs two new event types to complete the type safety.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Zod (ws-events schema), Bun test (core), Vitest + @testing-library/react (dashboard)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/core/src/schemas/ws-events.ts` | Add `chat:output` and `chat:completed` event shapes |
| Create | `packages/dashboard/src/hooks/use-chat.ts` | Manage chat open/streaming state, send/stop actions |
| Create | `packages/dashboard/src/hooks/use-chat.test.ts` | Unit tests for hook logic |
| Modify | `packages/dashboard/src/components/board/CardDialog.tsx` | Add chat button + inline chat panel |

---

### Task 1: Add `chat:output` and `chat:completed` to WS event schema

**Files:**
- Modify: `packages/core/src/schemas/ws-events.ts`

The server already broadcasts `chat:output` and `chat:completed` events (see `packages/server/src/routes/chat.ts`) but they are absent from the Zod discriminated union, so the client has no type-safe shape for them.

- [ ] **Step 1: Add the two event types**

Edit `packages/core/src/schemas/ws-events.ts`. After the `update:available` entry (line 73), add:

```typescript
  z.object({
    type: z.literal("chat:output"),
    payload: z.object({
      cardId: z.string(),
      chunk: z.string(),
    }),
  }),
  z.object({
    type: z.literal("chat:completed"),
    payload: z.object({
      cardId: z.string(),
      commentId: z.string(),
    }),
  }),
```

- [ ] **Step 2: Type-check core**

```bash
cd packages/core && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/schemas/ws-events.ts
git commit -m "feat: add chat:output and chat:completed to WS event schema"
```

---

### Task 2: Create `useChat` hook

**Files:**
- Create: `packages/dashboard/src/hooks/use-chat.ts`
- Create: `packages/dashboard/src/hooks/use-chat.test.ts`

The hook owns all chat-panel state: open/closed, streaming buffer, mode, thinking level, send/stop.

- [ ] **Step 1: Write the failing tests**

Create `packages/dashboard/src/hooks/use-chat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/ws", () => ({
  useWSEvent: vi.fn(),
  useWebSocket: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  chat: {
    send: vi.fn().mockResolvedValue({ ok: true }),
    stop: vi.fn().mockResolvedValue({ ok: true, killed: true }),
  },
}));

import { useChat } from "./use-chat";
import { chat as chatApi } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useChat", () => {
  it("starts closed and not streaming", () => {
    const { result } = renderHook(() => useChat("card-1"));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamBuffer).toBe("");
  });

  it("toggle opens and closes the panel", () => {
    const { result } = renderHook(() => useChat("card-1"));
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  it("send calls chatApi.send with correct args and sets streaming=true", async () => {
    const { result } = renderHook(() => useChat("card-1"));
    await act(async () => {
      await result.current.send("hello");
    });
    expect(chatApi.send).toHaveBeenCalledWith("card-1", {
      message: "hello",
      mode: "plan",
      thinking: "smart",
    });
    expect(result.current.isStreaming).toBe(true);
  });

  it("send ignores empty message", async () => {
    const { result } = renderHook(() => useChat("card-1"));
    await act(async () => {
      await result.current.send("   ");
    });
    expect(chatApi.send).not.toHaveBeenCalled();
  });

  it("stop calls chatApi.stop and clears streaming", async () => {
    const { result } = renderHook(() => useChat("card-1"));
    await act(async () => {
      await result.current.send("hello");
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(chatApi.stop).toHaveBeenCalledWith("card-1");
    expect(result.current.isStreaming).toBe(false);
  });

  it("chat:output event for this card appends to streamBuffer", () => {
    let capturedHandler: ((payload: unknown) => void) | null = null;
    vi.mocked(useWSEvent).mockImplementation((type, handler) => {
      if (type === "chat:output") capturedHandler = handler;
    });

    const { result } = renderHook(() => useChat("card-1"));

    act(() => {
      capturedHandler!({ cardId: "card-1", chunk: "hello " });
    });
    act(() => {
      capturedHandler!({ cardId: "card-1", chunk: "world" });
    });

    expect(result.current.streamBuffer).toBe("hello world");
  });

  it("chat:output event for a different card is ignored", () => {
    let capturedHandler: ((payload: unknown) => void) | null = null;
    vi.mocked(useWSEvent).mockImplementation((type, handler) => {
      if (type === "chat:output") capturedHandler = handler;
    });

    const { result } = renderHook(() => useChat("card-1"));

    act(() => {
      capturedHandler!({ cardId: "card-99", chunk: "ignored" });
    });

    expect(result.current.streamBuffer).toBe("");
  });

  it("chat:completed event clears streaming and buffer", () => {
    let outputHandler: ((payload: unknown) => void) | null = null;
    let completedHandler: ((payload: unknown) => void) | null = null;
    vi.mocked(useWSEvent).mockImplementation((type, handler) => {
      if (type === "chat:output") outputHandler = handler;
      if (type === "chat:completed") completedHandler = handler;
    });

    const { result } = renderHook(() => useChat("card-1"));

    act(() => {
      outputHandler!({ cardId: "card-1", chunk: "partial" });
    });
    act(() => {
      completedHandler!({ cardId: "card-1", commentId: "cmt-1" });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamBuffer).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/dashboard && bunx vitest run src/hooks/use-chat.test.ts
```

Expected: FAIL — `useChat` not found.

- [ ] **Step 3: Implement `useChat`**

Create `packages/dashboard/src/hooks/use-chat.ts`:

```typescript
import { useState, useCallback } from "react";
import { chat as chatApi } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";

export type ChatMode = "plan" | "execute";
export type ChatThinking = "smart" | "basic";

export interface UseChatReturn {
  isOpen: boolean;
  isStreaming: boolean;
  streamBuffer: string;
  mode: ChatMode;
  thinking: ChatThinking;
  toggle: () => void;
  setMode: (mode: ChatMode) => void;
  setThinking: (thinking: ChatThinking) => void;
  send: (message: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useChat(cardId: string | null): UseChatReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [mode, setMode] = useState<ChatMode>("plan");
  const [thinking, setThinking] = useState<ChatThinking>("smart");

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const send = useCallback(
    async (message: string) => {
      if (!cardId || !message.trim()) return;
      setIsStreaming(true);
      setStreamBuffer("");
      await chatApi.send(cardId, { message: message.trim(), mode, thinking });
    },
    [cardId, mode, thinking]
  );

  const stop = useCallback(async () => {
    if (!cardId) return;
    await chatApi.stop(cardId);
    setIsStreaming(false);
    setStreamBuffer("");
  }, [cardId]);

  useWSEvent("chat:output", (payload) => {
    const { cardId: eventCardId, chunk } = payload as { cardId: string; chunk: string };
    if (eventCardId !== cardId) return;
    setStreamBuffer((prev) => prev + chunk);
  });

  useWSEvent("chat:completed", (payload) => {
    const { cardId: eventCardId } = payload as { cardId: string; commentId: string };
    if (eventCardId !== cardId) return;
    setIsStreaming(false);
    setStreamBuffer("");
  });

  return { isOpen, isStreaming, streamBuffer, mode, thinking, toggle, setMode, setThinking, send, stop };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/dashboard && bunx vitest run src/hooks/use-chat.test.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Type-check dashboard**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/hooks/use-chat.ts packages/dashboard/src/hooks/use-chat.test.ts
git commit -m "feat: add useChat hook for session-scoped AI chat"
```

---

### Task 3: Add chat button and inline panel to CardDialog

**Files:**
- Modify: `packages/dashboard/src/components/board/CardDialog.tsx`

Add a `MessageSquare` icon button to the activity header. When the panel is open, show mode/thinking selectors, a text input, send/stop buttons, and a live streaming preview area.

- [ ] **Step 1: Import `useChat` and add `MessageSquare` icon**

At the top of `CardDialog.tsx`:

1. Add `MessageSquare` to the lucide-react import line (line 18):
```typescript
import { Send, Play, Trash2, Eraser, Brain, Zap, FolderOpen, X, Settings, Bot, User, FileCode, Maximize2, Minimize2, GitCommit, ExternalLink, Upload, GitBranch, Sparkles, MessageSquare } from "lucide-react"
```

2. Add the import for `useChat` after the existing hook imports (around line 22):
```typescript
import { useChat } from "@/hooks/use-chat"
```

- [ ] **Step 2: Wire up `useChat` in component state**

After the existing state declarations (around line 92, after `dragCounterRef`), add:

```typescript
const chat = useChat(card?.id ?? null)
const [chatInput, setChatInput] = useState("")
```

- [ ] **Step 3: Add Chat button to activity header**

Locate the activity header buttons section (around line 727–748):

```typescript
<div className="flex items-center gap-1">
  {comments.length > 0 && (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => void clearComments()}
      title="Clear all comments"
    >
      <Eraser className="w-3.5 h-3.5 text-muted-foreground" />
    </Button>
  )}
  <Button   // <-- this is the maximize button, insert before it
```

Insert a new button before the maximize button:

```typescript
<Button
  variant={chat.isOpen ? "secondary" : "ghost"}
  size="icon"
  className="h-6 w-6"
  onClick={chat.toggle}
  title="Chat with AI"
>
  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
</Button>
```

- [ ] **Step 4: Add the inline chat panel**

After the `{renderCommentInput()}` call (around line 754), inside the `<div>` wrapper but before the `activityMaximized` portal, add the chat panel:

```typescript
{chat.isOpen && (
  <div className="mt-2 border rounded-md p-3 space-y-2 bg-muted/30">
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Chat with AI</span>
      {chat.isStreaming && (
        <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          Thinking…
        </span>
      )}
      <div className="flex items-center gap-1 ml-auto">
        {(["plan", "execute"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => chat.setMode(m)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors capitalize",
              chat.mode === m
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-muted-foreground"
            )}
          >
            {m}
          </button>
        ))}
        <span className="mx-1 text-muted-foreground/40">|</span>
        {(["smart", "basic"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => chat.setThinking(t)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors capitalize",
              chat.thinking === t
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:border-muted-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
    {chat.streamBuffer && (
      <div className="text-xs bg-muted/50 rounded p-2 max-h-[200px] overflow-auto whitespace-pre-wrap break-words text-muted-foreground">
        {chat.streamBuffer}
      </div>
    )}
    <div className="flex items-end gap-2">
      <Textarea
        autoResize
        rows={1}
        placeholder="Ask or tell the AI something…"
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !chat.isStreaming) {
            e.preventDefault()
            void chat.send(chatInput).then(() => setChatInput(""))
          }
        }}
        disabled={chat.isStreaming}
        className="min-h-[36px]"
      />
      {chat.isStreaming ? (
        <Button
          size="icon"
          variant="outline"
          onClick={() => void chat.stop()}
          title="Stop"
        >
          <X className="w-4 h-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          variant="outline"
          onClick={() => {
            void chat.send(chatInput).then(() => setChatInput(""))
          }}
          disabled={!chatInput.trim()}
        >
          <Send className="w-4 h-4" />
        </Button>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Type-check dashboard**

```bash
cd packages/dashboard && bunx tsc -b
```

Expected: no errors. Fix any import or type issues found.

- [ ] **Step 6: Run all dashboard tests**

```bash
cd packages/dashboard && bunx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/components/board/CardDialog.tsx
git commit -m "feat: add session chat button and panel to CardDialog activity box"
```
