import { useState, useEffect, useCallback } from "react";
import { comments as commentsApi, type Comment } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";

export function useComments(cardId: string | null) {
  const [data, setData] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!cardId) return;
    try {
      setLoading(true);
      const result = await commentsApi.list(cardId);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    if (cardId) void refresh();
    else setData([]);
  }, [cardId, refresh]);

  useWSEvent("comment:added", (payload) => {
    const comment = payload as Comment;
    if (comment.card_id === cardId) {
      setData((prev) => [...prev, comment]);
    }
  });

  const add = useCallback(
    async (content: string) => {
      if (!cardId) return;
      const comment = await commentsApi.create(cardId, { content });
      setData((prev) => [...prev, comment]);
    },
    [cardId]
  );

  return { comments: data, loading, refresh, add };
}
