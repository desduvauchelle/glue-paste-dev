import type { Database } from "bun:sqlite";
import type { ConfigInput, BoardId } from "../types/index.js";
import { DEFAULT_CONFIG, type CliProvider } from "../schemas/config.js";

interface ConfigRow {
  key: string;
  cli_provider: string;
  cli_custom_command: string;
  model: string;
  max_budget_usd: number;
  auto_confirm: number;
  plan_mode: number;
  thinking_level: string;
  custom_tags: string;
  custom_instructions: string;
}

function rowToConfigInput(row: ConfigRow): Required<ConfigInput> {
  return {
    cliProvider: (row.cli_provider || "claude") as CliProvider,
    cliCustomCommand: row.cli_custom_command || "",
    model: row.model,
    maxBudgetUsd: row.max_budget_usd,
    autoConfirm: row.auto_confirm === 1,
    planMode: row.plan_mode === 1,
    thinkingLevel: (row.thinking_level || "smart") as "smart" | "basic",
    customTags: JSON.parse(row.custom_tags) as string[],
    customInstructions: row.custom_instructions,
  };
}

export function getGlobalConfig(db: Database): Required<ConfigInput> {
  const row = db
    .query("SELECT * FROM config WHERE key = 'global'")
    .get() as ConfigRow | null;
  if (!row) return { ...DEFAULT_CONFIG, customTags: [...DEFAULT_CONFIG.customTags] };
  return rowToConfigInput(row);
}

export function getProjectConfig(
  db: Database,
  boardId: BoardId
): ConfigInput | null {
  const row = db
    .query("SELECT * FROM config WHERE key = ?")
    .get(boardId) as ConfigRow | null;
  if (!row) return null;
  return rowToConfigInput(row);
}

/** Get merged config: project overrides global */
export function getMergedConfig(
  db: Database,
  boardId: BoardId
): Required<ConfigInput> {
  const global = getGlobalConfig(db);
  const project = getProjectConfig(db, boardId);
  if (!project) return global;

  return {
    cliProvider: project.cliProvider ?? global.cliProvider,
    cliCustomCommand: project.cliCustomCommand ?? global.cliCustomCommand,
    model: project.model ?? global.model,
    maxBudgetUsd: project.maxBudgetUsd ?? global.maxBudgetUsd,
    autoConfirm: project.autoConfirm ?? global.autoConfirm,
    planMode: project.planMode ?? global.planMode,
    thinkingLevel: project.thinkingLevel ?? global.thinkingLevel,
    customTags: project.customTags ?? global.customTags,
    customInstructions: project.customInstructions ?? global.customInstructions,
  };
}

export function updateGlobalConfig(
  db: Database,
  input: ConfigInput
): Required<ConfigInput> {
  return upsertConfig(db, "global", input);
}

export function updateProjectConfig(
  db: Database,
  boardId: BoardId,
  input: ConfigInput
): Required<ConfigInput> {
  return upsertConfig(db, boardId, input);
}

function upsertConfig(
  db: Database,
  key: string,
  input: ConfigInput
): Required<ConfigInput> {
  const existing = db
    .query("SELECT * FROM config WHERE key = ?")
    .get(key) as ConfigRow | null;

  const current = existing
    ? rowToConfigInput(existing)
    : { ...DEFAULT_CONFIG, customTags: [...DEFAULT_CONFIG.customTags] };

  const merged = {
    cliProvider: input.cliProvider ?? current.cliProvider,
    cliCustomCommand: input.cliCustomCommand ?? current.cliCustomCommand,
    model: input.model ?? current.model,
    maxBudgetUsd: input.maxBudgetUsd ?? current.maxBudgetUsd,
    autoConfirm: input.autoConfirm ?? current.autoConfirm,
    planMode: input.planMode ?? current.planMode,
    thinkingLevel: input.thinkingLevel ?? current.thinkingLevel,
    customTags: input.customTags ?? current.customTags,
    customInstructions: input.customInstructions ?? current.customInstructions,
  };

  db.query(
    `INSERT INTO config (key, cli_provider, cli_custom_command, model, max_budget_usd, auto_confirm, plan_mode, thinking_level, custom_tags, custom_instructions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cli_provider = excluded.cli_provider,
       cli_custom_command = excluded.cli_custom_command,
       model = excluded.model,
       max_budget_usd = excluded.max_budget_usd,
       auto_confirm = excluded.auto_confirm,
       plan_mode = excluded.plan_mode,
       thinking_level = excluded.thinking_level,
       custom_tags = excluded.custom_tags,
       custom_instructions = excluded.custom_instructions`
  ).run(
    key,
    merged.cliProvider,
    merged.cliCustomCommand,
    merged.model,
    merged.maxBudgetUsd,
    merged.autoConfirm ? 1 : 0,
    merged.planMode ? 1 : 0,
    merged.thinkingLevel,
    JSON.stringify(merged.customTags),
    merged.customInstructions
  );

  return merged;
}
