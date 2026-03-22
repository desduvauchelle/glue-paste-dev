import { useState, useCallback } from "react";

export type SortMode = "custom" | "recent" | "alpha";

export const SORT_MODE_LABELS: Record<SortMode, string> = {
  custom: "Custom",
  recent: "Recent",
  alpha: "A–Z",
};

export function useCardSort(boardId: string) {
  const [sortMode, setSortModeState] = useState<SortMode>(() => {
    const stored = localStorage.getItem(`card-sort-${boardId}`);
    return (stored as SortMode) || "custom";
  });

  const setSortMode = useCallback(
    (mode: SortMode) => {
      setSortModeState(mode);
      localStorage.setItem(`card-sort-${boardId}`, mode);
    },
    [boardId]
  );

  return { sortMode, setSortMode };
}
