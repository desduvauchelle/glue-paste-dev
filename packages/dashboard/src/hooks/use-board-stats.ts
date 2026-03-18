import { useState, useEffect, useCallback } from "react";
import { stats, type BoardStatusCounts, type DonePerDay } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";

export function useBoardStats() {
  const [boardCounts, setBoardCounts] = useState<BoardStatusCounts>({});
  const [donePerDay, setDonePerDay] = useState<DonePerDay[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const [counts, done] = await Promise.all([
      stats.boardCounts().catch(() => ({}) as BoardStatusCounts),
      stats.donePerDay().catch(() => [] as DonePerDay[]),
    ]);
    setBoardCounts(counts);
    setDonePerDay(done);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useWebSocket(
    useCallback(
      (event) => {
        if (
          event.type === "card:created" ||
          event.type === "card:updated" ||
          event.type === "card:deleted" ||
          event.type === "execution:completed" ||
          event.type === "ws:reconnected"
        ) {
          void fetchAll();
        }
      },
      [fetchAll]
    )
  );

  return { boardCounts, donePerDay, loading };
}
