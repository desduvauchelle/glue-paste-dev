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
  onClickCard: (card: CardWithTags) => void;
  onMoveCard: (id: string, status: string, position: number) => void;
}

const COLUMNS = [
  { status: "todo", title: "To Do" },
  { status: "queued", title: "Queued" },
  { status: "in-progress", title: "In Progress" },
  { status: "done", title: "Done" },
  { status: "failed", title: "Failed" },
] as const;

export function KanbanBoard({ grouped, onPlayCard, onClickCard, onMoveCard }: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<CardWithTags | null>(null);
  // Local state for optimistic column updates during drag
  const [localGrouped, setLocalGrouped] = useState<Record<string, CardWithTags[]> | null>(null);

  const displayGrouped = localGrouped ?? grouped;

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

    let newCards = [...(localGrouped[overColumn] ?? [])];

    if (activeColumn === overColumn) {
      // Reorder within same column
      const oldIndex = newCards.findIndex((c) => c.id === activeId);
      const newIndex = newCards.findIndex((c) => c.id === overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        newCards = arrayMove(newCards, oldIndex, newIndex);
      }
    }

    // Find the final position of the active card
    const position = newCards.findIndex((c) => c.id === activeId);
    const finalPosition = position >= 0 ? position : 0;

    setLocalGrouped(null);
    onMoveCard(activeId, overColumn, finalPosition);
  }, [localGrouped, findColumnForCard, onMoveCard]);

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
      <div className="flex gap-4 overflow-x-auto h-full">
        {COLUMNS.map(({ status, title }) => (
          <KanbanColumn
            key={status}
            title={title}
            status={status}
            cards={displayGrouped[status] ?? []}
            onPlayCard={onPlayCard}
            onClickCard={onClickCard}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <div className="opacity-80 rotate-2 w-[280px]">
            <KanbanCard
              card={activeCard}
              onPlay={() => {}}
              onClick={() => {}}
              isDragOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
