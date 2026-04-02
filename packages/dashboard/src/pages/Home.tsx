import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useBoards } from "@/hooks/use-boards";
import { useBoardStats } from "@/hooks/use-board-stats";
import { useWebSocket } from "@/lib/ws";
import { queue } from "@/lib/api";
import type { StatusKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FolderOpen, Check, X, Settings, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CaffeineToggle } from "@/components/CaffeineToggle";
import { UpdateButton } from "@/components/UpdateButton";
import { InstallWidget } from "@/components/InstallWidget";
import { BOARD_COLORS, getBoardColor } from "@/lib/colors";
import { CardDialog } from "@/components/board/CardDialog";
import { cards as cardsApi } from "@/lib/api";
import type { CreateCard } from "@/lib/api";
import { readSortMode, readCustomOrder, sortBoards, type SortMode } from "@/lib/sort-boards";
import { RunningCards } from "@/components/home/RunningCards";

function SortableBoardCard({
  id,
  children,
}: {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const dragHandle = (
    <div
      {...attributes}
      {...listeners}
      title="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground"
    >
      <GripVertical className="w-4 h-4" />
    </div>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(dragHandle)}
    </div>
  );
}

const STATUS_PILL_COLORS: Record<StatusKey, { bg: string; text: string; label: string }> = {
  todo: { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-600 dark:text-zinc-400", label: "Todo" },
  queued: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-400", label: "Queued" },
  "in-progress": { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-400", label: "Active" },
  done: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-400", label: "Done" },
  failed: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-400", label: "Failed" },
};

export function Home() {
  const { boards, loading, create } = useBoards();
  const { boardCounts, donePerDay, donePerDayByBoard } = useBoardStats();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [activeBoards, setActiveBoards] = useState<Set<string>>(new Set());
  const [cardDialogBoardId, setCardDialogBoardId] = useState<string | null>(null);
  const [selectedRunningCard, setSelectedRunningCard] = useState<{ card: import("@/lib/api").CardWithTags; boardId: string } | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(readSortMode);
  const [customOrder, setCustomOrder] = useState<string[]>(readCustomOrder);

  const sortedBoards = useMemo(
    () => sortBoards(boards, sortMode, customOrder),
    [boards, sortMode, customOrder],
  );

  const handleSortModeChange = useCallback((mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem("glue-board-sort", mode);
    if (mode === "custom") {
      const currentIds = sortedBoards.map((b) => b.id);
      setCustomOrder(currentIds);
      localStorage.setItem("glue-board-order", JSON.stringify(currentIds));
    }
  }, [sortedBoards]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sortedBoards.map((b) => b.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    const newOrder = arrayMove(ids, oldIndex, newIndex);
    setCustomOrder(newOrder);
    localStorage.setItem("glue-board-order", JSON.stringify(newOrder));
  }, [sortedBoards]);

  const fetchAllQueueStatuses = useCallback(async (boardIds: string[]) => {
    const statuses = await Promise.all(
      boardIds.map((id) => queue.status(id).catch(() => null))
    );
    const active = new Set<string>();
    statuses.forEach((s, i) => {
      const id = boardIds[i];
      if (s && s.isRunning && s.current !== null && id) {
        active.add(id);
      }
    });
    setActiveBoards(active);
  }, []);

  useEffect(() => {
    document.title = "Glue Paste";
    return () => { document.title = "Glue Paste"; };
  }, []);

  useEffect(() => {
    if (boards.length > 0) {
      void fetchAllQueueStatuses(boards.map((b) => b.id));
    }
  }, [boards, fetchAllQueueStatuses]);

  useWebSocket(useCallback((event) => {
    const payload = event.payload as Record<string, unknown> | null;
    if (event.type === "queue:updated" && payload) {
      const boardId = payload.boardId as string;
      setActiveBoards((prev) => {
        const next = new Set(prev);
        if (payload.current !== null) {
          next.add(boardId);
        } else if (!payload.isRunning) {
          next.delete(boardId);
        }
        return next;
      });
    } else if (event.type === "queue:stopped" && payload) {
      const boardId = payload.boardId as string;
      setActiveBoards((prev) => {
        const next = new Set(prev);
        next.delete(boardId);
        return next;
      });
    } else if (event.type === "card:updated" && payload) {
      const boardId = payload.board_id as string;
      if (payload.status === "in-progress") {
        setActiveBoards((prev) => {
          const next = new Set(prev);
          next.add(boardId);
          return next;
        });
      }
    } else if (event.type === "ws:reconnected") {
      if (boards.length > 0) {
        void fetchAllQueueStatuses(boards.map((b) => b.id));
      }
    }
  }, [boards, fetchAllQueueStatuses]));

  const handleCreate = async () => {
    if (!name.trim() || !directory.trim()) return;
    const board = await create({ name: name.trim(), description: description.trim(), directory: directory.trim(), color });
    setDialogOpen(false);
    setName("");
    setDescription("");
    setDirectory("");
    setColor(null);
    setLocation(`/boards/${board.id}`);
  };

  return (
    <div className="max-w-6xl mx-auto p-8">
      <InstallWidget />
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <img src="/fav-original.jpeg" alt="GluePasteDev logo" className="w-12 h-12 rounded-xl object-cover" />
          <div>
          <h1 className="text-3xl font-bold">GluePasteDev</h1>
          <p className="text-muted-foreground mt-1">AI-powered Kanban boards for automated coding</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UpdateButton />
          <CaffeineToggle />
          <Button variant="ghost" size="icon" onClick={() => setLocation("/settings")} title="Global Settings">
            <Settings className="w-4 h-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Board
          </Button>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Board</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto">
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="My Project"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description (optional)</label>
                <Textarea
                  placeholder="What this project is about..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Project Directory</label>
                <Input
                  placeholder="/Users/you/projects/my-app"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">Paste the full path to your project</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Color</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors"
                    style={{ borderColor: color === null ? "currentColor" : "transparent" }}
                    onClick={() => setColor(null)}
                    title="No color"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  {BOARD_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                      style={{ backgroundColor: c.bg, outline: color === c.value ? "2px solid currentColor" : "none", outlineOffset: "2px" }}
                      onClick={() => setColor(c.value)}
                      title={c.name}
                    >
                      {color === c.value && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={!name.trim() || !directory.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading boards...</p>
      ) : boards.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-lg">No boards yet</p>
            <p className="text-muted-foreground text-sm mt-1">Create your first board to get started</p>
          </CardContent>
        </Card>
      ) : (
        <>
        {donePerDay.some((d) => d.count > 0) && (() => {
          const maxCount = Math.max(...donePerDay.map((d) => d.count), 1);
          return (
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Tasks Completed — Last 14 Days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-1" style={{ height: 120 }}>
                  {donePerDay.map((d) => {
                    const pct = (d.count / maxCount) * 100;
                    const date = new Date(d.date + "T00:00:00");
                    const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center min-w-0">
                        {d.count > 0 && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{d.count}</span>
                        )}
                        <div className="w-full flex-1 flex items-end">
                          <div
                            className="w-full rounded-sm bg-green-500/80 transition-all"
                            style={{ height: `${Math.max(pct, d.count > 0 ? 4 : 0)}%` }}
                            title={`${label}: ${d.count}`}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center shrink-0">
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <RunningCards
          activeBoards={activeBoards}
          boards={boards}
          onCardClick={(card, boardId) => setSelectedRunningCard({ card, boardId })}
        />

        <div className="flex items-center gap-1 mb-4">
          <span className="text-xs text-muted-foreground mr-2">Sort:</span>
          {(["custom", "recent", "alpha"] as SortMode[]).map((mode) => {
            const labels: Record<SortMode, string> = { custom: "Custom", recent: "Recent", alpha: "A-Z" };
            return (
              <button
                key={mode}
                type="button"
                aria-label={labels[mode]}
                data-active={sortMode === mode ? "true" : "false"}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  sortMode === mode
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40"
                }`}
                onClick={() => handleSortModeChange(mode)}
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={sortedBoards.map((b) => b.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4">
              {sortedBoards.map((board) => {
                const series = donePerDayByBoard[board.id];
                const hasActivity = series?.some((d) => d.count > 0);
                const maxCount = hasActivity ? Math.max(...series!.map((d) => d.count), 1) : 1;
                const boardColor = getBoardColor(board.color);
                const cardContent = (dragHandle: React.ReactNode) => (
                  <Card
                    className="cursor-pointer hover:border-foreground/20 transition-colors overflow-hidden"
                    style={getBoardColor(board.color) ? { borderLeftWidth: "4px", borderLeftColor: getBoardColor(board.color)!.border } : undefined}
                    onClick={() => setLocation(`/boards/${board.id}`)}
                  >
                    <div className="flex flex-col md:flex-row">
                      <div className="flex-shrink-0 md:w-2/5 p-6">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-2">
                            {sortMode === "custom" && dragHandle}
                            <h3 className="text-lg font-semibold leading-none tracking-tight">{board.name}</h3>
                            {activeBoards.has(board.id) && (
                              <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
                              </span>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCardDialogBoardId(board.id);
                            }}
                            title="Add card"
                          >
                            <Plus className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                        {board.description && (
                          <p className="text-sm text-muted-foreground mt-1.5">{board.description}</p>
                        )}
                        {boardCounts[board.id] && (
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {(Object.keys(STATUS_PILL_COLORS) as StatusKey[]).map((status) => {
                              const count = boardCounts[board.id]?.[status] ?? 0;
                              if (count === 0) return null;
                              const pill = STATUS_PILL_COLORS[status];
                              return (
                                <span
                                  key={status}
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pill.bg} ${pill.text}`}
                                  title={pill.label}
                                >
                                  {count} {pill.label}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 p-6 pt-0 md:pt-6 md:pl-0">
                        {hasActivity ? (
                          <div className="flex gap-1 h-full" style={{ minHeight: 100 }}>
                            {series!.map((d) => {
                              const pct = (d.count / maxCount) * 100;
                              const date = new Date(d.date + "T00:00:00");
                              const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                              return (
                                <div key={d.date} className="flex-1 flex flex-col items-center min-w-0">
                                  {d.count > 0 && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">{d.count}</span>
                                  )}
                                  <div className="w-full flex-1 flex items-end">
                                    <div
                                      className="w-full rounded-sm transition-all"
                                      style={{
                                        height: `${Math.max(pct, d.count > 0 ? 4 : 0)}%`,
                                        backgroundColor: boardColor ? `${boardColor.bg}cc` : "rgb(34 197 94 / 0.8)",
                                      }}
                                      title={`${label}: ${d.count}`}
                                    />
                                  </div>
                                  <span className="text-[9px] text-muted-foreground truncate w-full text-center shrink-0">
                                    {label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full text-xs text-muted-foreground" style={{ minHeight: 100 }}>
                            No activity yet
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );

                return sortMode === "custom" ? (
                  <SortableBoardCard key={board.id} id={board.id}>
                    {cardContent}
                  </SortableBoardCard>
                ) : (
                  <div key={board.id}>{cardContent(null)}</div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
        </>
      )}
      {cardDialogBoardId && (
        <CardDialog
          open={true}
          onOpenChange={(open) => { if (!open) setCardDialogBoardId(null); }}
          card={null}
          boardId={cardDialogBoardId}
          onCreate={async (input: CreateCard) => {
            await cardsApi.create(cardDialogBoardId, input);
            setCardDialogBoardId(null);
          }}
          onUpdate={async () => {}}
          onDelete={async () => {}}
          onPlay={() => {}}
          defaultStatus="todo"
          boardName={boards.find((b) => b.id === cardDialogBoardId)?.name}
        />
      )}
      {selectedRunningCard && (
        <CardDialog
          open={true}
          onOpenChange={(open) => { if (!open) setSelectedRunningCard(null); }}
          card={selectedRunningCard.card}
          boardId={selectedRunningCard.boardId}
          onCreate={async () => {}}
          onUpdate={async (id, input) => {
            await cardsApi.update(id, input);
            setSelectedRunningCard(null);
          }}
          onDelete={async (id) => {
            await cardsApi.delete(id);
            setSelectedRunningCard(null);
          }}
          onPlay={() => {}}
          boardName={boards.find((b) => b.id === selectedRunningCard.boardId)?.name}
        />
      )}
    </div>
  );
}
