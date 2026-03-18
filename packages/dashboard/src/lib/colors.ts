export const BOARD_COLORS = [
  { name: "Red", value: "red", bg: "#ef4444", border: "#ef4444" },
  { name: "Orange", value: "orange", bg: "#f97316", border: "#f97316" },
  { name: "Amber", value: "amber", bg: "#f59e0b", border: "#f59e0b" },
  { name: "Green", value: "green", bg: "#22c55e", border: "#22c55e" },
  { name: "Teal", value: "teal", bg: "#14b8a6", border: "#14b8a6" },
  { name: "Blue", value: "blue", bg: "#3b82f6", border: "#3b82f6" },
  { name: "Purple", value: "purple", bg: "#a855f7", border: "#a855f7" },
  { name: "Pink", value: "pink", bg: "#ec4899", border: "#ec4899" },
] as const;

export function getBoardColor(value: string | null) {
  if (!value) return null;
  return BOARD_COLORS.find((c) => c.value === value) ?? null;
}
