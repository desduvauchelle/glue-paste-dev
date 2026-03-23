import type { Database } from "bun:sqlite";
import type { ConfigInput, BoardId } from "../types/index.js";
import { DEFAULT_CONFIG, type CliProvider, type BranchMode } from "../schemas/config.js";

interface ConfigRow {
  key: string;
  cli_provider: string | null;
  cli_custom_command: string | null;
  model: string | null;
  plan_model: string | null;
  execute_model: string | null;
  max_budget_usd: number | null;
  auto_commit: number | null;
  auto_push: number | null;
  plan_thinking: string | null;
  execute_thinking: string | null;
  custom_tags: string | null;
  custom_instructions: string | null;
  branch_mode: string | null;
  branch_name: string | null;
}

/** Fully resolved config — used for global config and merged results */
function rowToConfigInput(row: ConfigRow): Required<ConfigInput> {
  return {
    cliProvider: (row.cli_provider || "claude") as CliProvider,
    cliCustomCommand: row.cli_custom_command || "",
    model: row.model || DEFAULT_CONFIG.model,
    planModel: row.plan_model || "",
    executeModel: row.execute_model || "",
    maxBudgetUsd: row.max_budget_usd ?? DEFAULT_CONFIG.maxBudgetUsd,
    autoCommit: row.auto_commit === null ? DEFAULT_CONFIG.autoCommit : row.auto_commit === 1,
    autoPush: row.auto_push === null ? DEFAULT_CONFIG.autoPush : row.auto_push === 1,
    planThinking: (row.plan_thinking as "smart" | "basic" | null) ?? "smart",
    executeThinking: (row.execute_thinking || "smart") as "smart" | "basic",
    customTags: JSON.parse(row.custom_tags || "[]") as string[],
    customInstructions: row.custom_instructions || "",
    branchMode: (row.branch_mode || "current") as BranchMode,
    branchName: row.branch_name || "",
  };
}

/** Partial config preserving NULL for "inherit" — used for raw project config */
function rowToPartialConfig(row: ConfigRow): ConfigInput {
  return {
    cliProvider: row.cli_provider !== null ? (row.cli_provider as CliProvider) : undefined,
    cliCustomCommand: row.cli_custom_command !== null ? row.cli_custom_command : undefined,
    model: row.model !== null ? row.model : undefined,
    planModel: row.plan_model !== null ? row.plan_model : undefined,
    executeModel: row.execute_model !== null ? row.execute_model : undefined,
    maxBudgetUsd: row.max_budget_usd !== null ? row.max_budget_usd : undefined,
    autoCommit: row.auto_commit !== null ? row.auto_commit === 1 : undefined,
    autoPush: row.auto_push !== null ? row.auto_push === 1 : undefined,
    planThinking: row.plan_thinking !== null ? (row.plan_thinking as "smart" | "basic") : undefined,
    executeThinking: row.execute_thinking !== null ? (row.execute_thinking as "smart" | "basic") : undefined,
    customTags: row.custom_tags !== null ? (JSON.parse(row.custom_tags) as string[]) : undefined,
    customInstructions: row.custom_instructions !== null ? row.custom_instructions : undefined,
    branchMode: row.branch_mode !== null ? (row.branch_mode as BranchMode) : undefined,
    branchName: row.branch_name !== null ? row.branch_name : undefined,
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
  return rowToPartialConfig(row);
}

/** Get raw project config with NULLs preserved (undefined = inherit from global) */
export function getProjectConfigRaw(
  db: Database,
  boardId: BoardId
): ConfigInput | null {
  const row = db
    .query("SELECT * FROM config WHERE key = ?")
    .get(boardId) as ConfigRow | null;
  if (!row) return null;
  return rowToPartialConfig(row);
}

/** Get merged config: project overrides global */
export function getMergedConfig(
  db: Database,
  boardId: BoardId
): Required<ConfigInput> {
  const global = getGlobalConfig(db);
  const row = db
    .query("SELECT * FROM config WHERE key = ?")
    .get(boardId) as ConfigRow | null;
  if (!row) return global;

  const project = rowToPartialConfig(row);

  return {
    cliProvider: project.cliProvider ?? global.cliProvider,
    cliCustomCommand: project.cliCustomCommand ?? global.cliCustomCommand,
    model: project.model ?? global.model,
    planModel: project.planModel !== undefined ? project.planModel : global.planModel,
    executeModel: project.executeModel !== undefined ? project.executeModel : global.executeModel,
    maxBudgetUsd: project.maxBudgetUsd ?? global.maxBudgetUsd,
    autoCommit: project.autoCommit ?? global.autoCommit,
    autoPush: project.autoPush ?? global.autoPush,
    planThinking: project.planThinking !== undefined ? project.planThinking : global.planThinking,
    executeThinking: project.executeThinking ?? global.executeThinking,
    customTags: project.customTags ?? global.customTags,
    customInstructions: project.customInstructions ?? global.customInstructions,
    branchMode: project.branchMode ?? global.branchMode,
    branchName: project.branchName ?? global.branchName,
  };
}

export function updateGlobalConfig(
  db: Database,
  input: ConfigInput
): Required<ConfigInput> {
  return upsertGlobalConfig(db, input);
}

export function updateProjectConfig(
  db: Database,
  boardId: BoardId,
  input: ConfigInput
): Required<ConfigInput> {
  return upsertProjectConfig(db, boardId, input);
}

function upsertGlobalConfig(
  db: Database,
  input: ConfigInput
): Required<ConfigInput> {
  const existing = db
    .query("SELECT * FROM config WHERE key = 'global'")
    .get() as ConfigRow | null;

  const current = existing
    ? rowToConfigInput(existing)
    : { ...DEFAULT_CONFIG, customTags: [...DEFAULT_CONFIG.customTags] };

  const merged: Required<ConfigInput> = {
    cliProvider: input.cliProvider ?? current.cliProvider,
    cliCustomCommand: input.cliCustomCommand ?? current.cliCustomCommand,
    model: input.model ?? current.model,
    planModel: input.planModel !== undefined ? input.planModel : current.planModel,
    executeModel: input.executeModel !== undefined ? input.executeModel : current.executeModel,
    maxBudgetUsd: input.maxBudgetUsd ?? current.maxBudgetUsd,
    autoCommit: input.autoCommit ?? current.autoCommit,
    autoPush: input.autoPush ?? current.autoPush,
    planThinking: input.planThinking !== undefined ? input.planThinking : current.planThinking,
    executeThinking: input.executeThinking ?? current.executeThinking,
    customTags: input.customTags ?? current.customTags,
    customInstructions: input.customInstructions ?? current.customInstructions,
    branchMode: input.branchMode ?? current.branchMode,
    branchName: input.branchName ?? current.branchName,
  };

  db.query(
    `INSERT INTO config (key, cli_provider, cli_custom_command, model, plan_model, execute_model, max_budget_usd, auto_commit, auto_push, plan_thinking, execute_thinking, custom_tags, custom_instructions, branch_mode, branch_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cli_provider = excluded.cli_provider,
       cli_custom_command = excluded.cli_custom_command,
       model = excluded.model,
       plan_model = excluded.plan_model,
       execute_model = excluded.execute_model,
       max_budget_usd = excluded.max_budget_usd,
       auto_commit = excluded.auto_commit,
       auto_push = excluded.auto_push,
       plan_thinking = excluded.plan_thinking,
       execute_thinking = excluded.execute_thinking,
       custom_tags = excluded.custom_tags,
       custom_instructions = excluded.custom_instructions,
       branch_mode = excluded.branch_mode,
       branch_name = excluded.branch_name`
  ).run(
    "global",
    merged.cliProvider ?? "claude",
    merged.cliCustomCommand ?? "",
    merged.model ?? "",
    merged.planModel ?? "",
    merged.executeModel ?? "",
    merged.maxBudgetUsd ?? 10,
    merged.autoCommit ? 1 : 0,
    merged.autoPush ? 1 : 0,
    merged.planThinking ?? null,
    merged.executeThinking ?? "smart",
    JSON.stringify(merged.customTags ?? []),
    merged.customInstructions ?? "",
    merged.branchMode ?? "current",
    merged.branchName ?? ""
  );

  return merged;
}

/** For project configs, store NULL in DB for fields that are undefined (meaning "inherit from global") */
function upsertProjectConfig(
  db: Database,
  key: string,
  input: ConfigInput
): Required<ConfigInput> {
  db.query(
    `INSERT INTO config (key, cli_provider, cli_custom_command, model, plan_model, execute_model, max_budget_usd, auto_commit, auto_push, plan_thinking, execute_thinking, custom_tags, custom_instructions, branch_mode, branch_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cli_provider = excluded.cli_provider,
       cli_custom_command = excluded.cli_custom_command,
       model = excluded.model,
       plan_model = excluded.plan_model,
       execute_model = excluded.execute_model,
       max_budget_usd = excluded.max_budget_usd,
       auto_commit = excluded.auto_commit,
       auto_push = excluded.auto_push,
       plan_thinking = excluded.plan_thinking,
       execute_thinking = excluded.execute_thinking,
       custom_tags = excluded.custom_tags,
       custom_instructions = excluded.custom_instructions,
       branch_mode = excluded.branch_mode,
       branch_name = excluded.branch_name`
  ).run(
    key,
    input.cliProvider ?? null,
    input.cliCustomCommand ?? null,
    input.model ?? null,
    input.planModel !== undefined ? (input.planModel ?? "") : null,
    input.executeModel !== undefined ? (input.executeModel ?? "") : null,
    input.maxBudgetUsd ?? null,
    input.autoCommit !== undefined ? (input.autoCommit ? 1 : 0) : null,
    input.autoPush !== undefined ? (input.autoPush ? 1 : 0) : null,
    input.planThinking !== undefined ? (input.planThinking ?? null) : null,
    input.executeThinking ?? null,
    input.customTags !== undefined ? JSON.stringify(input.customTags) : null,
    input.customInstructions ?? null,
    input.branchMode ?? null,
    input.branchName ?? null
  );

  // Return the merged config for API response
  return getMergedConfig(db, key as BoardId);
}
