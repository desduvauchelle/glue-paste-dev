export type SortMode = "custom" | "recent" | "alpha";

export function readSortMode(): SortMode {
  const v = localStorage.getItem("glue-board-sort");
  if (v === "custom" || v === "recent" || v === "alpha") return v;
  return "recent";
}

export function readCustomOrder(): string[] {
  try {
    return JSON.parse(localStorage.getItem("glue-board-order") ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function sortBoards<T extends { id: string; name: string; updated_at: string }>(
  boards: T[],
  mode: SortMode,
  customOrder: string[],
): T[] {
  if (mode === "alpha") {
    return [...boards].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (mode === "recent") {
    return [...boards].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }
  const orderMap = new Map(customOrder.map((id, i) => [id, i]));
  return [...boards].sort((a, b) => {
    const ai = orderMap.get(a.id) ?? Infinity;
    const bi = orderMap.get(b.id) ?? Infinity;
    return ai - bi;
  });
}
