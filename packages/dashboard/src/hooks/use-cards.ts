import { useState, useEffect, useCallback } from "react";
import {
  cards as cardsApi,
  type CardWithTags,
  type CreateCard,
  type UpdateCard,
} from "@/lib/api";
import { useWebSocket } from "@/lib/ws";

export function useCards(boardId: string) {
  const [data, setData] = useState<CardWithTags[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await cardsApi.list(boardId);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Listen for real-time card updates
  useWebSocket((event) => {
    if (event.type === "card:created") {
      const card = event.payload as CardWithTags;
      if (card.board_id === boardId) {
        setData((prev) => {
          // Avoid duplicates — create() already added it optimistically
          if (prev.some((c) => c.id === card.id)) return prev;
          return [...prev, card];
        });
      }
    }
    if (event.type === "card:updated") {
      const card = event.payload as CardWithTags;
      if (card.board_id === boardId) {
        setData((prev) => {
          const idx = prev.findIndex((c) => c.id === card.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = card;
            return next;
          }
          return prev;
        });
      }
    }
    if (event.type === "card:deleted") {
      const { cardId, boardId: deletedBoardId } = event.payload as { cardId: string; boardId: string };
      if (deletedBoardId === boardId) {
        setData((prev) => prev.filter((c) => c.id !== cardId));
      }
    }
  });

  const create = useCallback(
    async (input: CreateCard) => {
      const card = await cardsApi.create(boardId, input);
      setData((prev) => [...prev, card]);
      return card;
    },
    [boardId]
  );

  const update = useCallback(async (id: string, input: UpdateCard) => {
    const card = await cardsApi.update(id, input);
    setData((prev) => prev.map((c) => (c.id === id ? card : c)));
    return card;
  }, []);

  const move = useCallback(
    async (id: string, status: string, position: number) => {
      const card = await cardsApi.move(id, { status, position });
      setData((prev) => prev.map((c) => (c.id === id ? card : c)));
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    await cardsApi.delete(id);
    setData((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const execute = useCallback(async (id: string) => {
    await cardsApi.execute(id);
  }, []);

  // Group by status
  const grouped = {
    todo: data.filter((c) => c.status === "todo"),
    queued: data.filter((c) => c.status === "queued"),
    "in-progress": data.filter((c) => c.status === "in-progress"),
    done: data.filter((c) => c.status === "done"),
    failed: data.filter((c) => c.status === "failed"),
  };

  return { cards: data, grouped, loading, refresh, create, update, move, remove, execute };
}
