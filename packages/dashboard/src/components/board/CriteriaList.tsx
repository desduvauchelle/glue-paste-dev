import { useState } from "react";
import type { Criterion } from "@/lib/api";

interface CriteriaListProps {
  criteria: Criterion[];
  onAdd: (text: string) => void;
  onUpdate: (id: string, data: { text?: string; status?: "pending" | "pass" | "fail" }) => void;
  onRemove: (id: string) => void;
  onJumpToExecution?: (executionId: string) => void;
}

const STATUS_LABEL: Record<Criterion["status"], string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
};
const STATUS_CLASS: Record<Criterion["status"], string> = {
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
