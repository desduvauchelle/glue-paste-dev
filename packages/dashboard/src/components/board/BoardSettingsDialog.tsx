import { useState, useEffect } from "react";
import type { Board, ConfigData, PartialConfigData, CliProvider, BranchMode } from "@/lib/api";
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
  onDelete?: (boardId: string) => Promise<void>;
}

export function BoardSettingsDialog({
  open,
  onOpenChange,
  board,
  onUpdated,
  onDelete,
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
  const [autoCommit, setAutoCommit] = useState(false);
  const [autoPush, setAutoPush] = useState(false);
  const [planThinking, setPlanThinking] = useState<"smart" | "basic" | null>("smart");
  const [executeThinking, setExecuteThinking] = useState<"smart" | "basic">("smart");
  const [customInstructions, setCustomInstructions] = useState("");
  const [branchMode, setBranchMode] = useState<BranchMode>("current");
  const [branchName, setBranchName] = useState("");
  const [maxConcurrentCards, setMaxConcurrentCards] = useState(1);
  const [color, setColor] = useState<string | null>(null);
  const [slug, setSlug] = useState<string>("");
  const [githubUrl, setGithubUrl] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "cli" | "execution">("general");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

  const markDirty = (field: string) => setDirtyFields((prev) => new Set(prev).add(field));

  useEffect(() => {
    if (board && open) {
      setName(board.name);
      setDescription(board.description);
      setDirectory(board.directory);
      setColor(board.color ?? null);
      setSlug(board.slug ?? "");
      setGithubUrl(board.github_url ?? "");
      setShowDeleteConfirm(false);
      setDeleteConfirmName("");
      setDeleting(false);

      // Load raw project config (only explicitly set overrides) + global for fallback display
      Promise.all([
        configApi.getForBoardRaw(board.id),
        configApi.getGlobal(),
      ]).then(([raw, global]: [PartialConfigData, ConfigData]) => {
        // Track which fields already have explicit project-level overrides
        const existing = new Set<string>();
        if (raw.cliProvider !== undefined) existing.add("cliProvider");
        if (raw.cliCustomCommand !== undefined) existing.add("cliCustomCommand");
        if (raw.model !== undefined) existing.add("model");
        if (raw.planModel !== undefined) existing.add("planModel");
        if (raw.executeModel !== undefined) existing.add("executeModel");
        if (raw.maxBudgetUsd !== undefined) existing.add("maxBudgetUsd");
        if (raw.autoCommit !== undefined) existing.add("autoCommit");
        if (raw.autoPush !== undefined) existing.add("autoPush");
        if (raw.planThinking !== undefined) existing.add("planThinking");
        if (raw.executeThinking !== undefined) existing.add("executeThinking");
        if (raw.customInstructions !== undefined) existing.add("customInstructions");
        if (raw.branchMode !== undefined) existing.add("branchMode");
        if (raw.branchName !== undefined) existing.add("branchName");
        if (raw.maxConcurrentCards !== undefined) existing.add("maxConcurrentCards");
        setDirtyFields(existing);

        setCliProvider(raw.cliProvider ?? global.cliProvider ?? "claude");
        setCliCustomCommand(raw.cliCustomCommand ?? global.cliCustomCommand ?? "");
        setModel(raw.model ?? global.model ?? "");
        setPlanModel(raw.planModel ?? global.planModel ?? "");
        setExecuteModel(raw.executeModel ?? global.executeModel ?? "");
        setMaxBudgetUsd(raw.maxBudgetUsd ?? global.maxBudgetUsd ?? 10);
        setAutoCommit(raw.autoCommit ?? global.autoCommit ?? false);
        setAutoPush(raw.autoPush ?? global.autoPush ?? false);
        setPlanThinking(raw.planThinking !== undefined ? raw.planThinking : global.planThinking ?? "smart");
        setExecuteThinking(raw.executeThinking ?? global.executeThinking ?? "smart");
        setCustomInstructions(raw.customInstructions ?? global.customInstructions ?? "");
        setBranchMode(raw.branchMode ?? global.branchMode ?? "current");
        setBranchName(raw.branchName ?? global.branchName ?? "");
        setMaxConcurrentCards(raw.maxConcurrentCards ?? global.maxConcurrentCards ?? 1);
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
        slug: slug.trim() || null,
        github_url: githubUrl.trim() || null,
      });

      // Only send fields that were explicitly set at project level or changed by user
      const configUpdate: Partial<ConfigData> = {};
      if (dirtyFields.has("cliProvider")) configUpdate.cliProvider = cliProvider;
      if (dirtyFields.has("cliCustomCommand")) configUpdate.cliCustomCommand = cliCustomCommand.trim();
      if (dirtyFields.has("model")) configUpdate.model = model.trim();
      if (dirtyFields.has("planModel")) configUpdate.planModel = planModel.trim();
      if (dirtyFields.has("executeModel")) configUpdate.executeModel = executeModel.trim();
      if (dirtyFields.has("maxBudgetUsd")) configUpdate.maxBudgetUsd = maxBudgetUsd;
      if (dirtyFields.has("autoCommit")) configUpdate.autoCommit = autoCommit;
      if (dirtyFields.has("autoPush")) configUpdate.autoPush = autoPush;
      if (dirtyFields.has("planThinking")) configUpdate.planThinking = planThinking;
      if (dirtyFields.has("executeThinking")) configUpdate.executeThinking = executeThinking;
      if (dirtyFields.has("customInstructions")) configUpdate.customInstructions = customInstructions.trim();
      if (dirtyFields.has("branchMode")) configUpdate.branchMode = branchMode;
      if (dirtyFields.has("branchName")) configUpdate.branchName = branchName.trim();
      if (dirtyFields.has("maxConcurrentCards")) configUpdate.maxConcurrentCards = maxConcurrentCards;
      await configApi.updateForBoard(board.id, configUpdate);

      onUpdated(updated);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || deleteConfirmName !== board.name) return;
    setDeleting(true);
    try {
      await onDelete(board.id);
      onOpenChange(false);
    } finally {
      setDeleting(false);
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
                <label className="text-sm font-medium mb-1 block">
                  Slug{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  placeholder="e.g. my-project"
                  value={slug}
                  onChange={(e) =>
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Lowercase letters, numbers, hyphens, and underscores only
                </p>
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
                <label className="text-sm font-medium mb-1 block">
                  GitHub URL{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  placeholder="https://github.com/owner/repo"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Links commits on cards to GitHub for code review
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

              {/* Danger Zone */}
              {onDelete && (
                <div className="border border-red-200 dark:border-red-900/50 rounded-lg p-4 mt-2">
                  <h4 className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Danger Zone</h4>
                  {!showDeleteConfirm ? (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Permanently delete this board and all its history.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900/50 dark:hover:bg-red-950/30 shrink-0 ml-4"
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        Delete Board
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        This action cannot be undone. Type <strong>{board.name}</strong> to confirm.
                      </p>
                      <Input
                        placeholder={board.name}
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        className="border-red-200 dark:border-red-900/50"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(""); }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="bg-red-600 hover:bg-red-700 text-white"
                          disabled={deleteConfirmName !== board.name || deleting}
                          onClick={() => void handleDelete()}
                        >
                          {deleting ? "Deleting..." : "Permanently Delete"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                        onChange={() => { setCliProvider(p.value); markDirty("cliProvider"); }}
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
                    onChange={(e) => { setCliCustomCommand(e.target.value); markDirty("cliCustomCommand"); }}
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
                  onChange={(e) => { setModel(e.target.value); markDirty("model"); }}
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
                  onChange={(e) => { setPlanModel(e.target.value); markDirty("planModel"); }}
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
                  onChange={(e) => { setExecuteModel(e.target.value); markDirty("executeModel"); }}
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
              onMaxBudgetUsdChange={(v) => { setMaxBudgetUsd(v); markDirty("maxBudgetUsd"); }}
              maxConcurrentCards={maxConcurrentCards}
              onMaxConcurrentCardsChange={(v) => { setMaxConcurrentCards(v); markDirty("maxConcurrentCards"); }}
              autoCommit={autoCommit}
              onAutoCommitChange={(v) => { setAutoCommit(v); markDirty("autoCommit"); }}
              autoPush={autoPush}
              onAutoPushChange={(v) => { setAutoPush(v); markDirty("autoPush"); }}
              planThinking={planThinking}
              onPlanThinkingChange={(v) => { setPlanThinking(v); markDirty("planThinking"); }}
              executeThinking={executeThinking}
              onExecuteThinkingChange={(v) => { setExecuteThinking(v); markDirty("executeThinking"); }}
              customInstructions={customInstructions}
              onCustomInstructionsChange={(v) => { setCustomInstructions(v); markDirty("customInstructions"); }}
              branchMode={branchMode}
              onBranchModeChange={(v) => { setBranchMode(v); markDirty("branchMode"); }}
              branchName={branchName}
              onBranchNameChange={(v) => { setBranchName(v); markDirty("branchName"); }}
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
