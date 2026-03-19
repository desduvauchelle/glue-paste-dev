export const BOARD_COLORS = [
  { name: "Red", value: "red", bg: "#ef4444", border: "#ef4444" },
  { name: "Rose", value: "rose", bg: "#f43f5e", border: "#f43f5e" },
  { name: "Orange", value: "orange", bg: "#f97316", border: "#f97316" },
  { name: "Amber", value: "amber", bg: "#f59e0b", border: "#f59e0b" },
  { name: "Yellow", value: "yellow", bg: "#eab308", border: "#eab308" },
  { name: "Lime", value: "lime", bg: "#84cc16", border: "#84cc16" },
  { name: "Green", value: "green", bg: "#22c55e", border: "#22c55e" },
  { name: "Emerald", value: "emerald", bg: "#10b981", border: "#10b981" },
  { name: "Teal", value: "teal", bg: "#14b8a6", border: "#14b8a6" },
  { name: "Cyan", value: "cyan", bg: "#06b6d4", border: "#06b6d4" },
  { name: "Sky", value: "sky", bg: "#0ea5e9", border: "#0ea5e9" },
  { name: "Blue", value: "blue", bg: "#3b82f6", border: "#3b82f6" },
  { name: "Indigo", value: "indigo", bg: "#6366f1", border: "#6366f1" },
  { name: "Violet", value: "violet", bg: "#8b5cf6", border: "#8b5cf6" },
  { name: "Purple", value: "purple", bg: "#a855f7", border: "#a855f7" },
  { name: "Fuchsia", value: "fuchsia", bg: "#d946ef", border: "#d946ef" },
  { name: "Pink", value: "pink", bg: "#ec4899", border: "#ec4899" },
  { name: "Slate", value: "slate", bg: "#64748b", border: "#64748b" },
] as const;

export function getBoardColor(value: string | null) {
  if (!value) return null;
  return BOARD_COLORS.find((c) => c.value === value) ?? null;
}
