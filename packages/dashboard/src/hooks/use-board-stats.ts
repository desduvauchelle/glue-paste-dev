import { useState, useEffect, useCallback } from "react";
import { stats, type BoardStatusCounts, type DonePerDay, type DonePerDayByBoard } from "@/lib/api";
import { useWebSocket } from "@/lib/ws";

export function useBoardStats() {
  const [boardCounts, setBoardCounts] = useState<BoardStatusCounts>({});
  const [donePerDay, setDonePerDay] = useState<DonePerDay[]>([]);
  const [donePerDayByBoard, setDonePerDayByBoard] = useState<DonePerDayByBoard>({});
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    const tzOffset = new Date().getTimezoneOffset();
    const [counts, done, doneByBoard] = await Promise.all([
      stats.boardCounts().catch(() => ({}) as BoardStatusCounts),
      stats.donePerDay(undefined, tzOffset).catch(() => [] as DonePerDay[]),
      stats.donePerDayByBoard(undefined, tzOffset).catch(() => ({}) as DonePerDayByBoard),
    ]);
    setBoardCounts(counts);
    setDonePerDay(done);
    setDonePerDayByBoard(doneByBoard);
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

  return { boardCounts, donePerDay, donePerDayByBoard, loading };
}
