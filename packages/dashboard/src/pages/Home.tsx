import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useBoards } from "@/hooks/use-boards";
import { useBoardStats } from "@/hooks/use-board-stats";
import { useWebSocket } from "@/lib/ws";
import { queue } from "@/lib/api";
import type { StatusKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FolderOpen, Trash2, Check, X, Settings } from "lucide-react";
import { BOARD_COLORS, getBoardColor } from "@/lib/colors";

const STATUS_PILL_COLORS: Record<StatusKey, { bg: string; text: string; label: string }> = {
  todo: { bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-600 dark:text-zinc-400", label: "Todo" },
  queued: { bg: "bg-blue-100 dark:bg-blue-900/40", text: "text-blue-700 dark:text-blue-400", label: "Queued" },
  "in-progress": { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-400", label: "Active" },
  done: { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-400", label: "Done" },
  failed: { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-400", label: "Failed" },
};

export function Home() {
  const { boards, loading, create, remove } = useBoards();
  const { boardCounts, donePerDay, donePerDayByBoard } = useBoardStats();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [activeBoards, setActiveBoards] = useState<Set<string>>(new Set());

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
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <img src="/fav-original.jpeg" alt="GluePasteDev logo" className="w-12 h-12 rounded-xl object-cover" />
          <div>
          <h1 className="text-3xl font-bold">GluePasteDev</h1>
          <p className="text-muted-foreground mt-1">AI-powered Kanban boards for automated coding</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Card
              key={board.id}
              className="cursor-pointer hover:border-foreground/20 transition-colors overflow-hidden"
              style={getBoardColor(board.color) ? { borderLeftWidth: "4px", borderLeftColor: getBoardColor(board.color)!.border } : undefined}
              onClick={() => setLocation(`/boards/${board.id}`)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">{board.name}</CardTitle>
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
                      void remove(board.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                {board.description && (
                  <CardDescription>{board.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {board.directory}
                </p>
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
              </CardContent>
            </Card>
          ))}
        </div>

        {boards
          .filter((b) => donePerDayByBoard[b.id]?.some((d) => d.count > 0))
          .map((board) => {
            const series = donePerDayByBoard[board.id]!;
            const maxCount = Math.max(...series.map((d) => d.count), 1);
            const boardColor = getBoardColor(board.color);
            return (
              <Card key={board.id} className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {board.name} — Last 14 Days
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-1" style={{ height: 120 }}>
                    {series.map((d) => {
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
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
