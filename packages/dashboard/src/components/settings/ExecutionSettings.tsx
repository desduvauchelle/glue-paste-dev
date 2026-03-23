import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BranchMode } from "@/lib/api";

interface ExecutionSettingsProps {
  maxBudgetUsd: number;
  onMaxBudgetUsdChange: (v: number) => void;
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
  branchMode?: BranchMode;
  onBranchModeChange?: (v: BranchMode) => void;
  branchName?: string;
  onBranchNameChange?: (v: string) => void;
  /** Unique prefix for radio button names to avoid conflicts */
  radioPrefix?: string;
}

export function ExecutionSettings({
  maxBudgetUsd,
  onMaxBudgetUsdChange,
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
  branchMode,
  onBranchModeChange,
  branchName,
  onBranchNameChange,
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

      {onBranchModeChange && (
        <div>
          <label className="text-sm font-medium mb-1 block">Branch Mode</label>
          <div className="flex items-center gap-3">
            {(["current", "new", "specific"] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="radio"
                  name={`${radioPrefix}-branch-mode`}
                  checked={branchMode === mode}
                  onChange={() => onBranchModeChange(mode)}
                  className="accent-primary"
                />
                <span className="text-sm">
                  {mode === "current" ? "Current" : mode === "new" ? "New branch" : "Specific"}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {branchMode === "current" && "Work on the current branch"}
            {branchMode === "new" && "Create a new branch for each card"}
            {branchMode === "specific" && "Use a specific branch name"}
          </p>
        </div>
      )}

      {onBranchNameChange && branchMode === "specific" && (
        <div>
          <label className="text-sm font-medium mb-1 block">Branch Name</label>
          <Input
            placeholder="e.g., feature/my-branch"
            value={branchName ?? ""}
            onChange={(e) => onBranchNameChange(e.target.value)}
          />
        </div>
      )}

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
