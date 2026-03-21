import { useState, useCallback, useMemo } from "react";
import type { CardWithTags } from "@/lib/api";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  pointerWithin,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

interface KanbanBoardProps {
  grouped: Record<string, CardWithTags[]>;
  onPlayCard: (id: string) => void;
  onStopCard: (id: string) => void;
  onClickCard: (card: CardWithTags) => void;
  onCoPlanCard?: (card: CardWithTags) => void;
  onReorderCards: (updates: Array<{ id: string; status: string; position: number }>) => void;
  onAddCard?: (status: string) => void;
}

const COLUMNS = [
  { status: "todo", title: "To Do" },
  { status: "queued", title: "Queued" },
  { status: "in-progress", title: "In Progress" },
  { status: "done", title: "Done" },
  { status: "failed", title: "Failed" },
] as const;

const ADD_CARD_STATUSES = new Set(["todo", "queued"]);
const SORTABLE_STATUSES = new Set(["todo", "queued"]);

export function KanbanBoard({ grouped, onPlayCard, onStopCard, onClickCard, onCoPlanCard, onReorderCards, onAddCard }: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<CardWithTags | null>(null);
  // Local state for optimistic column updates during drag
  const [localGrouped, setLocalGrouped] = useState<Record<string, CardWithTags[]> | null>(null);
  const [doneWeeksLoaded, setDoneWeeksLoaded] = useState(1);

  const displayGrouped = localGrouped ?? grouped;

  // Paginate done column: show only cards updated within the last N weeks
  const { filteredDoneCards, hasDoneMore } = useMemo(() => {
    const doneCards = displayGrouped["done"] ?? [];
    const cutoff = Date.now() - doneWeeksLoaded * 7 * 24 * 60 * 60 * 1000;
    const filtered = doneCards.filter((c) => {
      const ts = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      return ts >= cutoff;
    });
    const hasMore = doneCards.some((c) => {
      const ts = c.updated_at ? new Date(c.updated_at).getTime() : 0;
      return ts < cutoff;
    });
    return { filteredDoneCards: filtered, hasDoneMore: hasMore };
  }, [displayGrouped, doneWeeksLoaded]);

  const hasCardInProgress = useMemo(() => {
    return (grouped["in-progress"]?.length ?? 0) > 0;
  }, [grouped]);

  // All card IDs for lookup
  const allCards = useMemo(() => {
    const map = new Map<string, CardWithTags>();
    for (const cards of Object.values(grouped)) {
      for (const c of cards) map.set(c.id, c);
    }
    return map;
  }, [grouped]);

  // Custom collision detection: prefer pointerWithin, fallback to closestCorners
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCorners(args);
  }, []);

  const findColumnForCard = useCallback((cardId: string, source: Record<string, CardWithTags[]>): string | null => {
    for (const [status, cards] of Object.entries(source)) {
      if (cards.some((c) => c.id === cardId)) return status;
    }
    return null;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const card = allCards.get(String(event.active.id));
    if (card) {
      setActiveCard(card);
      setLocalGrouped({ ...grouped });
    }
  }, [allCards, grouped]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || !localGrouped) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeColumn = findColumnForCard(activeId, localGrouped);
    // Over could be a column ID or a card ID
    let overColumn = COLUMNS.some((c) => c.status === overId)
      ? overId
      : findColumnForCard(overId, localGrouped);

    if (!activeColumn || !overColumn || activeColumn === overColumn) return;

    // Prevent dropping into in-progress if another card is already there
    if (overColumn === "in-progress") {
      const inProgressCards = grouped["in-progress"] ?? [];
      const hasOtherInProgress = inProgressCards.some((c) => c.id !== activeId);
      if (hasOtherInProgress) return;
    }

    // Prevent dropping into done or failed — those are system-managed
    if (overColumn === "done" || overColumn === "failed") return;

    // Move card to the new column
    setLocalGrouped((prev) => {
      if (!prev) return prev;
      const sourceCards = prev[activeColumn]?.filter((c) => c.id !== activeId) ?? [];
      const card = allCards.get(activeId);
      if (!card) return prev;

      const destCards = [...(prev[overColumn] ?? [])];
      // Find insertion index based on over target
      const overIndex = destCards.findIndex((c) => c.id === overId);
      if (overIndex >= 0) {
        destCards.splice(overIndex, 0, card);
      } else {
        destCards.push(card);
      }

      return {
        ...prev,
        [activeColumn]: sourceCards,
        [overColumn]: destCards,
      };
    });
  }, [localGrouped, findColumnForCard, allCards]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over || !localGrouped) {
      setLocalGrouped(null);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeColumn = findColumnForCard(activeId, localGrouped);
    let overColumn = COLUMNS.some((c) => c.status === overId)
      ? overId
      : findColumnForCard(overId, localGrouped);

    if (!activeColumn) {
      setLocalGrouped(null);
      return;
    }

    // Default to the same column if no target column found
    if (!overColumn) overColumn = activeColumn;

    // Prevent dropping into in-progress if another card is already there
    if (overColumn === "in-progress" && activeColumn !== "in-progress") {
      const inProgressCards = grouped["in-progress"] ?? [];
      const hasOtherInProgress = inProgressCards.some((c) => c.id !== activeId);
      if (hasOtherInProgress) {
        setLocalGrouped(null);
        return;
      }
    }

    // Prevent dropping into done or failed
    if ((overColumn === "done" || overColumn === "failed") && activeColumn !== overColumn) {
      setLocalGrouped(null);
      return;
    }

    let destCards = [...(localGrouped[overColumn] ?? [])];

    if (activeColumn === overColumn) {
      // Reorder within same column — only allowed in sortable columns
      if (SORTABLE_STATUSES.has(activeColumn)) {
        const oldIndex = destCards.findIndex((c) => c.id === activeId);
        const newIndex = destCards.findIndex((c) => c.id === overId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          destCards = arrayMove(destCards, oldIndex, newIndex);
        }
      }
    }

    setLocalGrouped(null);

    // Build updates for all cards in affected columns
    const updates: Array<{ id: string; status: string; position: number }> = [];
    const columnsToUpdate = new Set([overColumn]);
    if (activeColumn !== overColumn) columnsToUpdate.add(activeColumn);

    for (const col of columnsToUpdate) {
      const colCards = col === overColumn ? destCards : (localGrouped[col] ?? []).filter((c) => c.id !== activeId);
      colCards.forEach((card, i) => {
        updates.push({ id: card.id, status: col, position: i });
      });
    }

    if (updates.length > 0) {
      onReorderCards(updates);
    }
  }, [localGrouped, findColumnForCard, onReorderCards]);

  const handleDragCancel = useCallback(() => {
    setActiveCard(null);
    setLocalGrouped(null);
  }, []);

  return (
    <DndContext
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 overflow-x-auto h-full px-3">
        {COLUMNS.map(({ status, title }) => {
          const isDone = status === "done";
          return (
            <KanbanColumn
              key={status}
              title={title}
              status={status}
              cards={isDone ? filteredDoneCards : (displayGrouped[status] ?? [])}
              onPlayCard={onPlayCard}
              onStopCard={onStopCard}
              onClickCard={onClickCard}
              onCoPlanCard={onCoPlanCard}
              hasMore={isDone ? hasDoneMore : undefined}
              onLoadMore={isDone ? () => setDoneWeeksLoaded((w) => w + 1) : undefined}
              totalCount={isDone ? (displayGrouped["done"]?.length ?? 0) : undefined}
              hasCardInProgress={hasCardInProgress}
              onAddCard={ADD_CARD_STATUSES.has(status) ? onAddCard : undefined}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="opacity-80 rotate-2 w-[280px]">
            <KanbanCard
              card={activeCard}
              onPlay={() => {}}
              onStop={() => {}}
              onClick={() => {}}
              isDragOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
