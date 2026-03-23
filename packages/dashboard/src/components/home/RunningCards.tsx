import { useState, useEffect, useCallback } from "react";
import type { CardWithTags, Board } from "@/lib/api";
import { cards as cardsApi } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { CardExecutionInfo } from "@/components/board/KanbanCard";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBoardColor } from "@/lib/colors";
import { cardLabel } from "@glue-paste-dev/core/browser";
import { useWebSocket } from "@/lib/ws";

interface RunningCardsProps {
  activeBoards: Set<string>;
  boards: Board[];
  onCardClick: (card: CardWithTags, boardId: string) => void;
}

export function RunningCards({ activeBoards, boards, onCardClick }: RunningCardsProps) {
  const [runningCards, setRunningCards] = useState<CardWithTags[]>([]);

  const fetchRunningCards = useCallback(async () => {
    if (activeBoards.size === 0) {
      setRunningCards([]);
      return;
    }
    const boardIds = Array.from(activeBoards);
    const results = await Promise.all(
      boardIds.map((id) => cardsApi.list(id, 0).catch(() => ({ cards: [], doneHasMore: false })))
    );
    const inProgress: CardWithTags[] = [];
    for (const result of results) {
      for (const card of result.cards) {
        if (card.status === "in-progress") {
          inProgress.push(card);
        }
      }
    }
    setRunningCards(inProgress);
  }, [activeBoards]);

  useEffect(() => {
    void fetchRunningCards();
  }, [fetchRunningCards]);

  useWebSocket(useCallback((event) => {
    if (
      event.type === "card:updated" ||
      event.type === "queue:updated" ||
      event.type === "execution:started" ||
      event.type === "execution:completed"
    ) {
      void fetchRunningCards();
    }
  }, [fetchRunningCards]));

  if (runningCards.length === 0) return null;

  const boardMap = new Map(boards.map((b) => [b.id, b]));

  return (
    <div className="mb-6">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">Running Now</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {runningCards.map((card) => {
          const board = boardMap.get(card.board_id);
          const boardColor = board ? getBoardColor(board.color) : null;
          return (
            <Card
              key={card.id}
              className="cursor-pointer hover:border-foreground/20 transition-colors bg-amber-900/30 border-amber-500/30 overflow-hidden"
              style={boardColor ? { borderLeftWidth: "4px", borderLeftColor: boardColor.border } : undefined}
              onClick={() => onCardClick(card, card.board_id)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm leading-tight break-words">{cardLabel(card)}</h4>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-amber-400 hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        void cardsApi.stop(card.id);
                      }}
                    >
                      <Square className="w-3 h-3 fill-current" />
                    </Button>
                  </div>
                </div>
                {board && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {board.name}
                  </p>
                )}
                <CardExecutionInfo card={card} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
