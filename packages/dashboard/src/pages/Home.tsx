import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useBoards } from "@/hooks/use-boards";
import { useWebSocket } from "@/lib/ws";
import { queue } from "@/lib/api";
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
import { Plus, FolderOpen, Trash2 } from "lucide-react";

export function Home() {
  const { boards, loading, create, remove } = useBoards();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
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
    const board = await create({ name: name.trim(), description: description.trim(), directory: directory.trim() });
    setDialogOpen(false);
    setName("");
    setDescription("");
    setDirectory("");
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
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Board
        </Button>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => (
            <Card
              key={board.id}
              className="cursor-pointer hover:border-foreground/20 transition-colors"
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
