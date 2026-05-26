import type { PlanSummary } from "@/lib/api";

interface PlanPanelProps {
  planSummary: PlanSummary | null;
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{title}</h4>
      <ul className="list-disc pl-5 space-y-0.5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function PlanPanel({ planSummary }: PlanPanelProps) {
  if (!planSummary) {
    return <p className="text-sm text-muted-foreground p-4">No plan summary yet. It is generated after the plan phase runs.</p>;
  }
  return (
    <div className="p-4">
      <Section title="Key Files" items={planSummary.key_files} />
      <Section title="Risks" items={planSummary.risks} />
      <Section title="Dependencies" items={planSummary.dependencies} />
    </div>
  );
}
