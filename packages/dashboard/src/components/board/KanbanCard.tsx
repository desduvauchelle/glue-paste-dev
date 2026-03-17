import type { CardWithTags } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Check, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface KanbanCardProps {
  card: CardWithTags;
  onPlay: (id: string) => void;
  onClick: (card: CardWithTags) => void;
  isDragOverlay?: boolean;
}

const statusColors: Record<string, string> = {
  todo: "bg-zinc-700",
  queued: "bg-blue-900/50 border-blue-500/30",
  "in-progress": "bg-amber-900/30 border-amber-500/30",
  done: "bg-green-900/30 border-green-500/30",
  failed: "bg-red-900/30 border-red-500/30",
};

export function KanbanCard({ card, onPlay, onClick, isDragOverlay }: KanbanCardProps) {
  const isRunning = card.status === "in-progress";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, disabled: isDragOverlay });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer hover:border-foreground/20 transition-all",
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
            <button
              type="button"
              className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
            <h4 className="font-medium text-sm leading-tight">{card.title}</h4>
          </div>
          {card.status === "todo" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(card.id);
              }}
            >
              <Play className="w-3 h-3" />
            </Button>
          )}
          {isRunning && (
            <span className="w-2.5 h-2.5 shrink-0 rounded-full bg-amber-400 animate-pulse" />
          )}
          {card.status === "done" && (
            <Check className="w-4 h-4 shrink-0 text-green-400" />
          )}
          {card.status === "failed" && (
            <X className="w-4 h-4 shrink-0 text-red-400" />
          )}
        </div>

        {card.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 ml-5">
            {card.description}
          </p>
        )}

        {(card.tags.length > 0 || card.blocking) && (
          <div className="flex flex-wrap gap-1 mt-2 ml-5">
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
