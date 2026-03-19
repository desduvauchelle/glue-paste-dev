export function cardLabel(card: { title: string; description: string }): string {
  if (card.title) return card.title;
  const trimmed = card.description.slice(0, 60);
  return trimmed.length < card.description.length ? trimmed + "..." : trimmed;
}
