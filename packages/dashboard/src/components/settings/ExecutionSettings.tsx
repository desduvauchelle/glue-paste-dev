import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface ExecutionSettingsProps {
  maxBudgetUsd: number;
  onMaxBudgetUsdChange: (v: number) => void;
  autoConfirm: boolean;
  onAutoConfirmChange: (v: boolean) => void;
  autoCommit: boolean;
  onAutoCommitChange: (v: boolean) => void;
  autoPush: boolean;
  onAutoPushChange: (v: boolean) => void;
  planThinking: "smart" | "basic" | null;
  onPlanThinkingChange: (v: "smart" | "basic" | null) => void;
  executeThinking: "smart" | "basic";
  onExecuteThinkingChange: (v: "smart" | "basic") => void;
  customInstructions: string;
  onCustomInstructionsChange: (v: string) => void;
  /** Unique prefix for radio button names to avoid conflicts */
  radioPrefix?: string;
}

export function ExecutionSettings({
  maxBudgetUsd,
  onMaxBudgetUsdChange,
  autoConfirm,
  onAutoConfirmChange,
  autoCommit,
  onAutoCommitChange,
  autoPush,
  onAutoPushChange,
  planThinking,
  onPlanThinkingChange,
  executeThinking,
  onExecuteThinkingChange,
  customInstructions,
  onCustomInstructionsChange,
  radioPrefix = "exec",
}: ExecutionSettingsProps) {
  return (
    <>
      <div>
        <label className="text-sm font-medium mb-1 block">Max Budget (USD)</label>
        <Input
          type="number"
          min={0}
          step={0.5}
          value={maxBudgetUsd}
          onChange={(e) => onMaxBudgetUsdChange(Number(e.target.value))}
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoConfirm}
          onChange={(e) => onAutoConfirmChange(e.target.checked)}
          className="accent-primary"
        />
        <span className="text-sm font-medium">Auto-confirm permissions</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoCommit}
          onChange={(e) => onAutoCommitChange(e.target.checked)}
          className="accent-primary"
        />
        <span className="text-sm font-medium">Auto-commit changes when done</span>
      </label>

      <label className={`flex items-center gap-2 cursor-pointer ${!autoCommit ? "opacity-50" : ""}`}>
        <input
          type="checkbox"
          checked={autoPush}
          onChange={(e) => onAutoPushChange(e.target.checked)}
          disabled={!autoCommit}
          className="accent-primary"
        />
        <span className="text-sm font-medium">Auto-push after commit</span>
      </label>

      <div>
        <label className="text-sm font-medium mb-1 block">Plan Thinking</label>
        <div className="flex items-center gap-3">
          {(["smart", "basic"] as const).map((level) => (
            <label key={level} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={planThinking === level}
                onChange={() => onPlanThinkingChange(planThinking === level ? null : level)}
                className="accent-primary"
              />
              <span className="text-sm">{level === "smart" ? "Smart" : "Normal"}</span>
            </label>
          ))}
          {planThinking === null && (
            <span className="text-xs text-muted-foreground">— No plan phase</span>
          )}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Execute Thinking</label>
        <div className="flex items-center gap-3">
          {(["smart", "basic"] as const).map((level) => (
            <label key={level} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                name={`${radioPrefix}-execute-thinking`}
                checked={executeThinking === level}
                onChange={() => onExecuteThinkingChange(level)}
                className="accent-primary"
              />
              <span className="text-sm">{level === "smart" ? "Smart" : "Normal"}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium mb-1 block">Custom Instructions</label>
        <Textarea
          placeholder="Additional instructions for the AI..."
          value={customInstructions}
          onChange={(e) => onCustomInstructionsChange(e.target.value)}
          className="min-h-[80px]"
        />
      </div>
    </>
  );
}
