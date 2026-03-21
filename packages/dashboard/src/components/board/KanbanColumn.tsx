import type { CardWithTags } from "@/lib/api";
import { KanbanCard } from "./KanbanCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo } from "react";
import { Plus } from "lucide-react";

interface KanbanColumnProps {
  title: string;
  status: string;
  cards: CardWithTags[];
  onPlayCard: (id: string) => void;
  onStopCard: (id: string) => void;
  onClickCard: (card: CardWithTags) => void;
  onCoPlanCard?: (card: CardWithTags) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  totalCount?: number;
  hasCardInProgress?: boolean;
  onAddCard?: (status: string) => void;
}

const columnColors: Record<string, string> = {
  todo: "border-t-zinc-500",
  queued: "border-t-blue-500",
  "in-progress": "border-t-amber-500",
  done: "border-t-green-500",
  failed: "border-t-red-500",
};

export function KanbanColumn({
  title,
  status,
  cards,
  onPlayCard,
  onStopCard,
  onClickCard,
  onCoPlanCard,
  hasMore,
  onLoadMore,
  totalCount,
  hasCardInProgress,
  onAddCard,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/col flex flex-col bg-secondary/30 rounded-lg border-t-2 min-w-[280px] max-w-[320px] w-full transition-colors",
        columnColors[status],
        isOver && "bg-secondary/60 ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
          {totalCount ?? cards.length}
        </span>
      </div>
      <div className="h-8 flex items-center justify-center px-2">
        {onAddCard && (
          <button
            type="button"
            onClick={() => onAddCard(status)}
            className="opacity-0 group-hover/col:opacity-100 transition-opacity w-full flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded border border-dashed border-transparent hover:border-border py-1"
          >
            <Plus className="w-3 h-3" />
            Add card
          </button>
        )}
      </div>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <ScrollArea className="flex-1 px-2 pb-2">
          <div className="space-y-2 min-h-[40px]">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                onPlay={onPlayCard}
                onStop={onStopCard}
                onClick={onClickCard}
                onCoPlan={onCoPlanCard}
                hasCardInProgress={hasCardInProgress}
              />
            ))}
            {hasMore && onLoadMore && (
              <button
                onClick={onLoadMore}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 rounded border border-dashed border-border hover:border-muted-foreground transition-colors"
              >
                Load older cards
              </button>
            )}
          </div>
        </ScrollArea>
      </SortableContext>
    </div>
  );
}
