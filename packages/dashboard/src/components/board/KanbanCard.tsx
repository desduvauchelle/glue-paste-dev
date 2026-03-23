import { useState, useEffect } from "react";
import type { CardWithTags, Execution } from "@/lib/api";
import { parseFilesChanged } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Check, X, GripVertical, Square, Brain, Zap, Circle, MessageSquare, FileCode, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardLabel } from "@glue-paste-dev/core/browser";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useExecutions } from "@/hooks/use-executions";

function parseUTC(dt: string): number {
  return new Date(dt.endsWith("Z") ? dt : dt + "Z").getTime();
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function PhaseIcon({ phase, planThinking, executeThinking }: { phase: string; planThinking: "smart" | "basic" | "none" | null; executeThinking: "smart" | "basic" | null }) {
  const level = phase === "plan" ? planThinking : executeThinking;
  if (level === "smart" || level === null) return <Brain className="w-3 h-3 shrink-0" />;
  return <Zap className="w-3 h-3 shrink-0" />;
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = now - parseUTC(startedAt);
  return <span>{formatElapsed(Math.max(0, elapsed))}</span>;
}

function getLatestRun(executions: Execution[]): Execution[] {
  if (executions.length === 0) return [];
  // Sort by started_at descending
  const sorted = [...executions].sort((a, b) => parseUTC(b.started_at) - parseUTC(a.started_at));
  // Latest run = most recent execute + its preceding plan (if any)
  const latest: Execution[] = [];
  const lastExec = sorted.find((e) => e.phase === "execute");
  const lastPlan = sorted.find((e) => e.phase === "plan");
  if (lastPlan) latest.push(lastPlan);
  if (lastExec) latest.push(lastExec);
  // If only plan exists (plan still running), just return that
  if (latest.length === 0 && sorted.length > 0) latest.push(sorted[0]!);
  return latest;
}

export function CardExecutionInfo({ card }: { card: CardWithTags }) {
  const needsExecInfo = card.status === "in-progress" || card.status === "done" || card.status === "failed";
  const { executions } = useExecutions(needsExecInfo ? card.id : null);

  if (!needsExecInfo || executions.length === 0) return null;

  const run = getLatestRun(executions);
  const planExec = run.find((e) => e.phase === "plan");
  const executeExec = run.find((e) => e.phase === "execute");
  const isRunning = card.status === "in-progress";

  if (isRunning) {
    const planSkipped = executeExec !== undefined && planExec === undefined;
    return (
      <div className="mt-1.5 ml-5 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        {/* Plan phase line */}
        <div className="flex items-center gap-1">
          <span className="w-10 shrink-0">Plan</span>
          {planSkipped ? (
            <span className="opacity-40 line-through">Skipped</span>
          ) : planExec?.finished_at ? (
            <span className="flex items-center gap-0.5 text-green-400">
              <Check className="w-3 h-3" />
              <span>{formatElapsed(parseUTC(planExec.finished_at) - parseUTC(planExec.started_at))}</span>
            </span>
          ) : planExec ? (
            <span className="flex items-center gap-0.5 animate-pulse">
              <PhaseIcon phase="plan" planThinking={card.plan_thinking} executeThinking={card.execute_thinking} />
              <ElapsedTimer startedAt={planExec.started_at} />
            </span>
          ) : (
            <span className="flex items-center gap-0.5 opacity-40">
              <Circle className="w-2.5 h-2.5" />
              <span>Pending</span>
            </span>
          )}
        </div>
        {/* Execute phase line */}
        <div className="flex items-center gap-1">
          <span className="w-10 shrink-0">Exec</span>
          {executeExec?.finished_at ? (
            <span className="flex items-center gap-0.5 text-green-400">
              <Check className="w-3 h-3" />
              <span>{formatElapsed(parseUTC(executeExec.finished_at) - parseUTC(executeExec.started_at))}</span>
            </span>
          ) : executeExec ? (
            <span className="flex items-center gap-0.5 animate-pulse">
              <PhaseIcon phase="execute" planThinking={card.plan_thinking} executeThinking={card.execute_thinking} />
              <ElapsedTimer startedAt={executeExec.started_at} />
            </span>
          ) : (
            <span className="flex items-center gap-0.5 opacity-40">
              <Circle className="w-2.5 h-2.5" />
              <span>Pending</span>
            </span>
          )}
        </div>
      </div>
    );
  }

  // Done / Failed — compact summary
  const filesChanged = executeExec ? parseFilesChanged(executeExec.files_changed) : [];
  const totalAdditions = filesChanged.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = filesChanged.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="mt-1.5 ml-5 flex items-center gap-2 text-[11px] text-muted-foreground">
      {planExec && planExec.finished_at && (
        <span className="flex items-center gap-0.5">
          <PhaseIcon phase="plan" planThinking={card.plan_thinking} executeThinking={card.execute_thinking} />
          {formatElapsed(parseUTC(planExec.finished_at) - parseUTC(planExec.started_at))}
        </span>
      )}
      {planExec && executeExec && <span>·</span>}
      {executeExec && executeExec.finished_at && (
        <span className="flex items-center gap-0.5">
          <PhaseIcon phase="execute" planThinking={card.plan_thinking} executeThinking={card.execute_thinking} />
          {formatElapsed(parseUTC(executeExec.finished_at) - parseUTC(executeExec.started_at))}
        </span>
      )}
      {filesChanged.length > 0 && (
        <>
          <span>·</span>
          <span className="flex items-center gap-0.5">
            <FileCode className="w-3 h-3" />
            {filesChanged.length} {filesChanged.length === 1 ? "file" : "files"}
            <span className="text-green-400">+{totalAdditions}</span>
            <span className="text-red-400">-{totalDeletions}</span>
          </span>
        </>
      )}
    </div>
  );
}

interface KanbanCardProps {
  card: CardWithTags;
  onPlay: (id: string) => void;
  onStop: (id: string) => void;
  onClick: (card: CardWithTags) => void;
  onCoPlan?: (card: CardWithTags) => void;
  hasCardInProgress?: boolean;
  isDragOverlay?: boolean;
  isDraggable?: boolean;
}

const statusColors: Record<string, string> = {
  todo: "bg-zinc-700",
  queued: "bg-blue-900/50 border-blue-500/30",
  "in-progress": "bg-amber-900/30 border-amber-500/30",
  done: "bg-green-900/30 border-green-500/30",
  failed: "bg-red-900/30 border-red-500/30",
};

export function KanbanCard({ card, onPlay, onStop, onClick, onCoPlan, hasCardInProgress, isDragOverlay, isDraggable }: KanbanCardProps) {
  const isRunning = card.status === "in-progress";
  const draggingEnabled = isDraggable !== false && !isDragOverlay;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: !draggingEnabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer hover:border-foreground/20 transition-all group",
        statusColors[card.status],
        isDragging && "opacity-30",
      )}
      onClick={() => {
        if (!isDragging) onClick(card);
      }}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-1.5 flex-1 min-w-0">
            {draggingEnabled && (
              <button
                type="button"
                className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
                {...attributes}
                {...listeners}
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>
            )}
            <h4 className={cn("font-medium text-sm leading-tight break-all", !card.title && "text-muted-foreground")}>{cardLabel(card)}</h4>
          </div>
          {!isRunning && onCoPlan && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onCoPlan(card);
              }}
              title="Co-Plan"
            >
              <MessageSquare className="w-3 h-3" />
            </Button>
          )}
          {card.status === "todo" && card.assignee !== "human" && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-6 w-6 shrink-0", hasCardInProgress && "opacity-30 cursor-not-allowed")}
              disabled={hasCardInProgress}
              title={hasCardInProgress ? "A card is already in progress" : "Add to queue"}
              onClick={(e) => {
                e.stopPropagation();
                onPlay(card.id);
              }}
            >
              <Play className="w-3 h-3" />
            </Button>
          )}
          {isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-amber-400 hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onStop(card.id);
              }}
            >
              <Square className="w-3 h-3 fill-current" />
            </Button>
          )}
          {card.status === "done" && (
            <Check className="w-4 h-4 shrink-0 text-green-400" />
          )}
          {card.status === "failed" && (
            <X className="w-4 h-4 shrink-0 text-red-400" />
          )}
        </div>

        {card.title && card.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 ml-5 break-all">
            {card.description}
          </p>
        )}

        <CardExecutionInfo card={card} />

        {(card.tags.length > 0 || card.blocking || card.assignee === "human") && (
          <div className="flex flex-wrap gap-1 mt-2 ml-5">
            {card.assignee === "human" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/50 text-violet-400">
                <User className="w-2.5 h-2.5 mr-0.5" />
                human
              </Badge>
            )}
            {card.blocking && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/50 text-red-400">
                blocking
              </Badge>
            )}
            {card.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
