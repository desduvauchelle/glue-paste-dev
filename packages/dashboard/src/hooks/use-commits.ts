import { useState, useEffect, useCallback } from "react";
import { commits as commitsApi, type CardCommit } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";

export function useCommits(cardId: string | null) {
  const [data, setData] = useState<CardCommit[]>([]);

  const refresh = useCallback(async () => {
    if (!cardId) return;
    const result = await commitsApi.list(cardId);
    setData(result);
  }, [cardId]);

  useEffect(() => {
    if (cardId) void refresh();
    else setData([]);
  }, [cardId, refresh]);

  // Refresh when execution completes (commits are captured after execution)
  useWSEvent("execution:completed", () => {
    if (cardId) void refresh();
  });

  return { commits: data, refresh };
}
