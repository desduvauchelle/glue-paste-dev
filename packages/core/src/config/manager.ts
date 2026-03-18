import type { Database } from "bun:sqlite";
import type { ConfigInput, BoardId } from "../types/index.js";
import { DEFAULT_CONFIG, type CliProvider } from "../schemas/config.js";

interface ConfigRow {
  key: string;
  cli_provider: string;
  cli_custom_command: string;
  model: string;
  plan_model: string;
  execute_model: string;
  max_budget_usd: number;
  auto_confirm: number;
  auto_commit: number;
  plan_thinking: string | null;
  execute_thinking: string;
  custom_tags: string;
  custom_instructions: string;
}

function rowToConfigInput(row: ConfigRow): Required<ConfigInput> {
  return {
    cliProvider: (row.cli_provider || "claude") as CliProvider,
    cliCustomCommand: row.cli_custom_command || "",
    model: row.model,
    planModel: row.plan_model || "",
    executeModel: row.execute_model || "",
    maxBudgetUsd: row.max_budget_usd,
    autoConfirm: row.auto_confirm === 1,
    autoCommit: row.auto_commit !== 0,
    planThinking: (row.plan_thinking as "smart" | "basic" | null) ?? "smart",
    executeThinking: (row.execute_thinking || "smart") as "smart" | "basic",
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
    planModel: project.planModel || global.planModel,
    executeModel: project.executeModel || global.executeModel,
    maxBudgetUsd: project.maxBudgetUsd ?? global.maxBudgetUsd,
    autoConfirm: project.autoConfirm ?? global.autoConfirm,
    autoCommit: project.autoCommit ?? global.autoCommit,
    planThinking: project.planThinking !== undefined ? project.planThinking : global.planThinking,
    executeThinking: project.executeThinking ?? global.executeThinking,
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
    planModel: input.planModel !== undefined ? input.planModel : current.planModel,
    executeModel: input.executeModel !== undefined ? input.executeModel : current.executeModel,
    maxBudgetUsd: input.maxBudgetUsd ?? current.maxBudgetUsd,
    autoConfirm: input.autoConfirm ?? current.autoConfirm,
    autoCommit: input.autoCommit ?? current.autoCommit,
    planThinking: input.planThinking !== undefined ? input.planThinking : current.planThinking,
    executeThinking: input.executeThinking ?? current.executeThinking,
    customTags: input.customTags ?? current.customTags,
    customInstructions: input.customInstructions ?? current.customInstructions,
  };

  db.query(
    `INSERT INTO config (key, cli_provider, cli_custom_command, model, plan_model, execute_model, max_budget_usd, auto_confirm, auto_commit, plan_thinking, execute_thinking, custom_tags, custom_instructions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cli_provider = excluded.cli_provider,
       cli_custom_command = excluded.cli_custom_command,
       model = excluded.model,
       plan_model = excluded.plan_model,
       execute_model = excluded.execute_model,
       max_budget_usd = excluded.max_budget_usd,
       auto_confirm = excluded.auto_confirm,
       auto_commit = excluded.auto_commit,
       plan_thinking = excluded.plan_thinking,
       execute_thinking = excluded.execute_thinking,
       custom_tags = excluded.custom_tags,
       custom_instructions = excluded.custom_instructions`
  ).run(
    key,
    merged.cliProvider ?? "claude",
    merged.cliCustomCommand ?? "",
    merged.model ?? "",
    merged.planModel ?? "",
    merged.executeModel ?? "",
    merged.maxBudgetUsd ?? 10,
    merged.autoConfirm ? 1 : 0,
    merged.autoCommit ? 1 : 0,
    merged.planThinking ?? null,
    merged.executeThinking ?? "smart",
    JSON.stringify(merged.customTags ?? []),
    merged.customInstructions ?? ""
  );

  return merged;
}
