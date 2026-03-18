import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import type { ConfigData, CliProvider } from "@/lib/api";
import { config as configApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, X } from "lucide-react";

const CLI_PROVIDERS: { value: CliProvider; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic Claude CLI" },
  { value: "gemini", label: "Gemini CLI", description: "Google Gemini CLI" },
  { value: "codex", label: "Codex CLI", description: "OpenAI Codex CLI" },
  { value: "aider", label: "Aider", description: "Aider AI pair programming" },
  { value: "copilot", label: "GitHub Copilot", description: "GitHub Copilot CLI" },
  { value: "custom", label: "Custom", description: "Custom CLI command" },
];

export function GlobalSettings() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"cli" | "execution">("cli");

  const [cliProvider, setCliProvider] = useState<CliProvider>("claude");
  const [cliCustomCommand, setCliCustomCommand] = useState("");
  const [model, setModel] = useState("");
  const [planModel, setPlanModel] = useState("");
  const [executeModel, setExecuteModel] = useState("");
  const [maxBudgetUsd, setMaxBudgetUsd] = useState(10);
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [autoCommit, setAutoCommit] = useState(true);
  const [planThinking, setPlanThinking] = useState<"smart" | "basic" | null>("smart");
  const [executeThinking, setExecuteThinking] = useState<"smart" | "basic">("smart");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    configApi.getGlobal().then((cfg: ConfigData) => {
      setCliProvider(cfg.cliProvider || "claude");
      setCliCustomCommand(cfg.cliCustomCommand || "");
      setModel(cfg.model);
      setPlanModel(cfg.planModel || "");
      setExecuteModel(cfg.executeModel || "");
      setMaxBudgetUsd(cfg.maxBudgetUsd);
      setAutoConfirm(cfg.autoConfirm);
      setAutoCommit(cfg.autoCommit);
      setPlanThinking(cfg.planThinking);
      setExecuteThinking(cfg.executeThinking);
      setCustomInstructions(cfg.customInstructions);
      setCustomTags(cfg.customTags || []);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await configApi.updateGlobal({
        cliProvider,
        cliCustomCommand: cliCustomCommand.trim(),
        model: model.trim(),
        planModel: planModel.trim(),
        executeModel: executeModel.trim(),
        maxBudgetUsd,
        autoConfirm,
        autoCommit,
        planThinking,
        executeThinking,
        customInstructions: customInstructions.trim(),
        customTags,
      });
      setLocation("/");
    } finally {
      setSaving(false);
    }
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !customTags.includes(tag)) {
      setCustomTags([...customTags, tag]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setCustomTags(customTags.filter((t) => t !== tag));
  };

  const tabClass = (tab: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
      activeTab === tab
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Global Settings</h1>
          <p className="text-sm text-muted-foreground">
            Default settings inherited by all boards
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b pb-2 mb-4">
        <button className={tabClass("cli")} onClick={() => setActiveTab("cli")}>
          CLI Provider
        </button>
        <button className={tabClass("execution")} onClick={() => setActiveTab("execution")}>
          Execution
        </button>
      </div>

      <div className="space-y-4 min-h-[300px]">
        {/* CLI Provider Tab */}
        {activeTab === "cli" && (
          <>
            <div>
              <label className="text-sm font-medium mb-1 block">Default CLI Provider</label>
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
              <label className="text-sm font-medium mb-1 block">Default Model</label>
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
          <>
            <div>
              <label className="text-sm font-medium mb-1 block">Default Max Budget (USD)</label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={maxBudgetUsd}
                onChange={(e) => setMaxBudgetUsd(Number(e.target.value))}
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoConfirm}
                onChange={(e) => setAutoConfirm(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-sm font-medium">Auto-confirm permissions</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCommit}
                onChange={(e) => setAutoCommit(e.target.checked)}
                className="accent-primary"
              />
              <span className="text-sm font-medium">Auto-commit changes when done</span>
            </label>

            <div>
              <label className="text-sm font-medium mb-1 block">Plan Thinking</label>
              <div className="flex items-center gap-3">
                {(["smart", "basic"] as const).map((level) => (
                  <label key={level} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={planThinking === level}
                      onChange={() => setPlanThinking(planThinking === level ? null : level)}
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
                      name="global-execute-thinking"
                      checked={executeThinking === level}
                      onChange={() => setExecuteThinking(level)}
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
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="min-h-[80px]"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Custom Tags</label>
              <p className="text-xs text-muted-foreground mb-2">
                Tags available to all boards for categorizing cards
              </p>
              {customTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {customTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="New tag..."
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={addTag} disabled={!newTag.trim()}>
                  Add
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
        <Button variant="outline" onClick={() => setLocation("/")}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
