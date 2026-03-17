import { useState, useEffect, useCallback } from "react";
import { boards as boardsApi, type Board, type CreateBoard } from "@/lib/api";

export function useBoards() {
  const [data, setData] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await boardsApi.list();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load boards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateBoard) => {
      const board = await boardsApi.create(input);
      setData((prev) => [board, ...prev]);
      return board;
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    await boardsApi.delete(id);
    setData((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return { boards: data, loading, error, refresh, create, remove };
}
