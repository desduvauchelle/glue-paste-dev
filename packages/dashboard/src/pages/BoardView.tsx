import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { boards as boardsApi, queue as queueApi, type Board, type CardWithTags } from "@/lib/api";
import { useCards } from "@/hooks/use-cards";
import { useWebSocket } from "@/lib/ws";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { CardDialog } from "@/components/board/CardDialog";
import { Button } from "@/components/ui/button";
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog";
import { ArrowLeft, Plus, Play, Square, Settings } from "lucide-react";

interface BoardViewProps {
  params: { boardId: string };
}

export function BoardView({ params }: BoardViewProps) {
  const { boardId } = params;
  const [, setLocation] = useLocation();
  const [board, setBoard] = useState<Board | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardWithTags | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { grouped, create, update, move, remove, execute, loading } = useCards(boardId);

  useEffect(() => {
    void boardsApi.get(boardId).then(setBoard);
    void queueApi.status(boardId).then((s) => setQueueRunning(s.isRunning));
  }, [boardId]);

  useWebSocket((event) => {
    if (event.type === "queue:updated") {
      setQueueRunning(true);
    }
    if (event.type === "queue:stopped") {
      setQueueRunning(false);
    }
  });

  const handlePlayCard = async (id: string) => {
    await execute(id);
  };

  const handlePlayAll = async () => {
    await queueApi.start(boardId);
    setQueueRunning(true);
  };

  const handleStopQueue = async () => {
    await queueApi.stop(boardId);
    setQueueRunning(false);
  };

  const handleClickCard = (card: CardWithTags) => {
    setSelectedCard(card);
    setDialogOpen(true);
  };

  const handleNewCard = () => {
    setSelectedCard(null);
    setDialogOpen(true);
  };

  if (!board) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading board...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <button
            type="button"
            className="text-left hover:opacity-80 transition-opacity"
            onClick={() => setSettingsOpen(true)}
          >
            <h1 className="text-lg font-semibold">{board.name}</h1>
            {board.description && (
              <p className="text-xs text-muted-foreground">{board.description}</p>
            )}
          </button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleNewCard}>
            <Plus className="w-4 h-4 mr-1" />
            Add Card
          </Button>
          {queueRunning ? (
            <Button variant="destructive" size="sm" onClick={() => void handleStopQueue()}>
              <Square className="w-4 h-4 mr-1" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => void handlePlayAll()}>
              <Play className="w-4 h-4 mr-1" />
              Play All
            </Button>
          )}
        </div>
      </header>

      {/* Kanban Board */}
      <main className="flex-1 overflow-hidden pt-4">
        {loading ? (
          <p className="text-muted-foreground">Loading cards...</p>
        ) : (
          <KanbanBoard
            grouped={grouped}
            onPlayCard={(id) => void handlePlayCard(id)}
            onClickCard={handleClickCard}
            onMoveCard={(id, status, position) => void move(id, status, position)}
          />
        )}
      </main>

      {/* Card Dialog */}
      <CardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        card={selectedCard}
        boardId={boardId}
        onCreate={create}
        onUpdate={update}
        onDelete={remove}
        onPlay={(id) => void handlePlayCard(id)}
      />

      {/* Board Settings Dialog */}
      <BoardSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        board={board}
        onUpdated={setBoard}
      />
    </div>
  );
}
