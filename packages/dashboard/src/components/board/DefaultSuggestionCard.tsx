import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, TestTubeDiagonal, Lightbulb } from "lucide-react";
import type { ComponentType } from "react";

export interface DefaultSuggestion {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

export const DEFAULT_SUGGESTIONS: DefaultSuggestion[] = [
  {
    id: "test-coverage",
    label: "Analyze test coverage gaps",
    description:
      "Run a test analysis across the codebase: identify modules and functions with no tests or weak coverage, then add the missing tests starting with the most critical paths.",
    icon: TestTubeDiagonal,
  },
  {
    id: "security-audit",
    label: "Security vulnerability audit",
    description:
      "Scan the codebase for common security vulnerabilities (OWASP Top 10, dependency issues, secrets in code). Report the biggest gaps and add fixes or mitigations.",
    icon: ShieldCheck,
  },
];

interface DefaultSuggestionCardProps {
  suggestion: DefaultSuggestion;
  onClick: (suggestion: DefaultSuggestion) => void;
}

export function DefaultSuggestionCard({ suggestion, onClick }: DefaultSuggestionCardProps) {
  const Icon = suggestion.icon;
  return (
    <Card
      className="cursor-pointer border-dashed border-muted-foreground/20 bg-transparent hover:bg-secondary/20 hover:border-muted-foreground/40 transition-all"
      onClick={() => onClick(suggestion)}
    >
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <Icon className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/60" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-muted-foreground/70 leading-tight">
              {suggestion.label}
            </h4>
          </div>
          <Lightbulb className="w-3 h-3 shrink-0 text-muted-foreground/30 mt-0.5" />
        </div>
      </CardContent>
    </Card>
  );
}
