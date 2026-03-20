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
    if (event.type === "execution:completed" || event.type === "ws:reconnected") {
      void refresh();
      return;
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
      setData((prev) => {
        if (prev.some((c) => c.id === card.id)) return prev;
        return [...prev, card];
      });
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

  const reorder = useCallback(
    async (updates: Array<{ id: string; status: string; position: number }>) => {
      await cardsApi.reorder(updates);
      setData((prev) => {
        const next = [...prev];
        for (const u of updates) {
          const idx = next.findIndex((c) => c.id === u.id);
          if (idx >= 0) {
            next[idx] = Object.assign({}, next[idx], { status: u.status, position: u.position }) as CardWithTags;
          }
        }
        return next;
      });
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

  const stop = useCallback(async (id: string) => {
    await cardsApi.stop(id);
  }, []);

  // Group by status with per-column sort order
  const grouped = (() => {
    const byPosition = (a: CardWithTags, b: CardWithTags) => a.position - b.position;
    const byCreatedAsc = (a: CardWithTags, b: CardWithTags) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    };
    const byCreatedDesc = (a: CardWithTags, b: CardWithTags) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    };

    return {
      todo: data.filter((c) => c.status === "todo").sort(byPosition),
      queued: data.filter((c) => c.status === "queued").sort(byPosition),
      "in-progress": data.filter((c) => c.status === "in-progress").sort(byCreatedAsc),
      done: data.filter((c) => c.status === "done").sort(byCreatedDesc),
      failed: data.filter((c) => c.status === "failed").sort(byCreatedDesc),
    };
  })();

  return { cards: data, grouped, loading, refresh, create, update, move, reorder, remove, execute, stop };
}
