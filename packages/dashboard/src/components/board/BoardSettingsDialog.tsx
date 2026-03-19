import { useState, useEffect } from "react";
import type { Board, ConfigData, PartialConfigData, CliProvider } from "@/lib/api";
import { boards as boardsApi, config as configApi } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BOARD_COLORS } from "@/lib/colors";
import { Check, X } from "lucide-react";
import { ExecutionSettings } from "@/components/settings/ExecutionSettings";

const CLI_PROVIDERS: { value: CliProvider; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic Claude CLI" },
  { value: "gemini", label: "Gemini CLI", description: "Google Gemini CLI" },
  { value: "codex", label: "Codex CLI", description: "OpenAI Codex CLI" },
  { value: "aider", label: "Aider", description: "Aider AI pair programming" },
  { value: "copilot", label: "GitHub Copilot", description: "GitHub Copilot CLI" },
  { value: "custom", label: "Custom", description: "Custom CLI command" },
];

interface BoardSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  onUpdated: (board: Board) => void;
}

export function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onUpdated,
}: BoardSettingsDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [cliProvider, setCliProvider] = useState<CliProvider>("claude");
  const [cliCustomCommand, setCliCustomCommand] = useState("");
  const [model, setModel] = useState("");
  const [planModel, setPlanModel] = useState("");
  const [executeModel, setExecuteModel] = useState("");
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(10);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoPush, setAutoPush] = useState(false);
  const [planThinking, setPlanThinking] = useState<"smart" | "basic" | null>("smart");
  const [executeThinking, setExecuteThinking] = useState<"smart" | "basic">("smart");
  const [customInstructions, setCustomInstructions] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "cli" | "execution">("general");

  useEffect(() => {
    if (board && open) {
      setName(board.name);
      setDescription(board.description);
      setDirectory(board.directory);
      setColor(board.color ?? null);

      // Load raw project config (only explicitly set overrides) + global for fallback display
      Promise.all([
        configApi.getForBoardRaw(board.id),
        configApi.getGlobal(),
      ]).then(([raw, global]: [PartialConfigData, ConfigData]) => {
        setCliProvider(raw.cliProvider ?? global.cliProvider ?? "claude");
        setCliCustomCommand(raw.cliCustomCommand ?? global.cliCustomCommand ?? "");
        setModel(raw.model ?? global.model ?? "");
        setPlanModel(raw.planModel ?? global.planModel ?? "");
        setExecuteModel(raw.executeModel ?? global.executeModel ?? "");
        setMaxBudgetUsd(raw.maxBudgetUsd ?? global.maxBudgetUsd ?? 10);
        setAutoConfirm(raw.autoConfirm ?? global.autoConfirm ?? true);
        setAutoCommit(raw.autoCommit ?? global.autoCommit ?? false);
        setAutoPush(raw.autoPush ?? global.autoPush ?? false);
        setPlanThinking(raw.planThinking !== undefined ? raw.planThinking : global.planThinking ?? "smart");
        setExecuteThinking(raw.executeThinking ?? global.executeThinking ?? "smart");
        setCustomInstructions(raw.customInstructions ?? global.customInstructions ?? "");
      }).catch(() => {
        // Use defaults
      });
    }
  }, [board, open]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const updated = await boardsApi.update(board.id, {
        name: name.trim(),
        description: description.trim(),
        directory: directory.trim(),
        color,
      });

      await configApi.updateForBoard(board.id, {
        cliProvider,
        cliCustomCommand: cliCustomCommand.trim(),
        model: model.trim(),
        planModel: planModel.trim(),
        executeModel: executeModel.trim(),
        maxBudgetUsd,
        autoConfirm,
        autoCommit,
        autoPush,
        planThinking,
        executeThinking,
        customInstructions: customInstructions.trim(),
      });

      onUpdated(updated);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const tabClass = (tab: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
      activeTab === tab
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Board Settings</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 border-b pb-2">
          <button className={tabClass("general")} onClick={() => setActiveTab("general")}>
            General
          </button>
          <button className={tabClass("cli")} onClick={() => setActiveTab("cli")}>
            CLI Provider
          </button>
          <button className={tabClass("execution")} onClick={() => setActiveTab("execution")}>
            Execution
          </button>
        </div>

        <div className="space-y-4 py-2 min-h-[260px]">
          {/* General Tab */}
          {activeTab === "general" && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="Board name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Textarea
                  placeholder="What is this project about?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[80px]"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Project Directory</label>
                <Input
                  placeholder="/path/to/project"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The directory where the CLI will execute tasks
                </p>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Color</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors"
                    style={{ borderColor: color === null ? "currentColor" : "transparent" }}
                    onClick={() => setColor(null)}
                    title="No color"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  {BOARD_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                      style={{ backgroundColor: c.bg, outline: color === c.value ? "2px solid currentColor" : "none", outlineOffset: "2px" }}
                      onClick={() => setColor(c.value)}
                      title={c.name}
                    >
                      {color === c.value && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* CLI Provider Tab */}
          {activeTab === "cli" && (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">CLI Provider</label>
                <div className="grid gap-2">
                  {CLI_PROVIDERS.map((p) => (
                    <label
                      key={p.value}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        cliProvider === p.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="cliProvider"
                        value={p.value}
                        checked={cliProvider === p.value}
                        onChange={() => setCliProvider(p.value)}
                        className="accent-primary"
                      />
                      <div>
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {cliProvider === "custom" && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Custom Command</label>
                  <Input
                    placeholder="e.g., my-cli --flag"
                    value={cliCustomCommand}
                    onChange={(e) => setCliCustomCommand(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The prompt will be appended as the last argument
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium mb-1 block">Model</label>
                <Input
                  placeholder="e.g., claude-opus-4-6, gemini-pro"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Fallback model when no phase-specific model is set
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Plan Phase Model</label>
                <Input
                  placeholder="Leave empty to use thinking-level default"
                  value={planModel}
                  onChange={(e) => setPlanModel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Override model used during the plan phase
                </p>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Execute Phase Model</label>
                <Input
                  placeholder="Leave empty to use thinking-level default"
                  value={executeModel}
                  onChange={(e) => setExecuteModel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Override model used during the execute phase
                </p>
              </div>
            </>
          )}

          {/* Execution Tab */}
          {activeTab === "execution" && (
            <ExecutionSettings
              maxBudgetUsd={maxBudgetUsd}
              onMaxBudgetUsdChange={setMaxBudgetUsd}
              autoConfirm={autoConfirm}
              onAutoConfirmChange={setAutoConfirm}
              autoCommit={autoCommit}
              onAutoCommitChange={setAutoCommit}
              autoPush={autoPush}
              onAutoPushChange={setAutoPush}
              planThinking={planThinking}
              onPlanThinkingChange={setPlanThinking}
              executeThinking={executeThinking}
              onExecuteThinkingChange={setExecuteThinking}
              customInstructions={customInstructions}
              onCustomInstructionsChange={setCustomInstructions}
              radioPrefix="board"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!name.trim() || saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
