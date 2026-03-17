import { useState, useEffect, useCallback } from "react";
import { executions as executionsApi, type Execution } from "@/lib/api";
import { useWSEvent } from "@/lib/ws";

export function useExecutions(cardId: string | null) {
  const [data, setData] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!cardId) return;
    try {
      setLoading(true);
      const result = await executionsApi.list(cardId);
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => {
    if (cardId) void refresh();
    else setData([]);
  }, [cardId, refresh]);

  useWSEvent("execution:started", (payload) => {
    const { cardId: startedCardId } = payload as { cardId: string; executionId: string; phase: string };
    if (startedCardId === cardId) void refresh();
  });

  useWSEvent("execution:completed", (payload) => {
    const { executionId } = payload as { executionId: string; status: string; exitCode: number };
    setData((prev) =>
      prev.map((e) =>
        e.id === executionId ? { ...e, status: (payload as { status: string }).status } : e
      )
    );
  });

  useWSEvent("execution:output", (payload) => {
    const { executionId, chunk } = payload as { executionId: string; chunk: string };
    setData((prev) =>
      prev.map((e) => (e.id === executionId ? { ...e, output: e.output + chunk } : e))
    );
  });

  return { executions: data, loading };
}
