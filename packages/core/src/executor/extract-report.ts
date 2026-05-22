import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { getFreshEnv } from "./fresh-env.js";
import { log } from "../logger.js";
import { PlanReportSchema, ExecuteReportSchema } from "../schemas/report.js";
import type { Criterion, ExecuteReport, FileChange, PlanReport } from "../types/index.js";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";

/** Parse a JSON object out of model output (fenced ```json block or bare object), then Zod-validate. */
export function parseReportJson<T>(
  text: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }
): T | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      const result = schema.safeParse(JSON.parse(candidate));
      if (result.success) return result.data as T;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Persist the raw report JSON for audit/debug under <directory>/.glue-paste/reports/<executionId>.json */
export function writeReportFile(directory: string, executionId: string, data: unknown): void {
  try {
    const dir = join(resolve(directory), ".glue-paste", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${executionId}.json`), JSON.stringify(data, null, 2));
  } catch (err) {
    log.warn("extract-report", `Failed to write report file for ${executionId}:`, err);
  }
}

async function runHaiku(prompt: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(
      ["claude", "-p", prompt, "--output-format", "text", "--max-turns", "2", "--model", EXTRACT_MODEL],
      { stdout: "pipe", stderr: "pipe", env: getFreshEnv() }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log.warn("extract-report", `Haiku CLI exited with code ${exitCode}`);
      return null;
    }
    return output;
  } catch (err) {
    log.warn("extract-report", "Haiku CLI call failed:", err);
    return null;
  }
}

export async function extractPlanReport(args: {
  title: string;
  description: string;
  planOutput: string;
}): Promise<PlanReport | null> {
  const prompt = `You analyze an AI implementation PLAN and extract structure. Reply with ONLY a JSON object, no prose, matching:
{"criteria": string[], "plan_summary": {"key_files": string[], "risks": string[], "dependencies": string[]}}
- "criteria": 2-6 concrete, checkable acceptance criteria the finished work must satisfy.
- "key_files": files the plan will create or modify.
- "risks"/"dependencies": short bullet phrases (may be empty arrays).

TASK TITLE: ${args.title}
TASK DESCRIPTION: ${args.description.slice(0, 2000)}

PLAN:
${args.planOutput.slice(-6000)}`;
  const output = await runHaiku(prompt);
  if (!output) return null;
  return parseReportJson<PlanReport>(output, PlanReportSchema);
}

export async function extractExecuteReport(args: {
  title: string;
  description: string;
  criteria: Criterion[];
  output: string;
  filesChanged: FileChange[];
  exitCode: number;
}): Promise<ExecuteReport | null> {
  const criteriaList = args.criteria.map((c) => `[${c.id}] ${c.text}`).join("\n");
  const filesList = args.filesChanged.map((f) => `${f.path} (+${f.additions}/-${f.deletions})`).join("\n") || "(none)";
  const prompt = `You verify whether an AI execution satisfied each acceptance criterion. Reply with ONLY a JSON object, no prose, matching:
{"criteria": [{"id": string, "status": "pass"|"fail", "evidence": string}], "completion_summary": string, "blocker": {"type": string, "root_cause": string, "resolution_route": string} | null}
- Return one entry per criterion id below; "evidence" cites a test result, command, or changed file (short).
- "completion_summary": one sentence on what shipped (empty if the run failed).
- "blocker": non-null ONLY if the run failed; otherwise null.

CRITERIA:
${criteriaList || "(none)"}

EXIT CODE: ${args.exitCode}
CHANGED FILES:
${filesList}

EXECUTION OUTPUT:
${args.output.slice(-6000)}`;
  const output = await runHaiku(prompt);
  if (!output) return null;
  return parseReportJson<ExecuteReport>(output, ExecuteReportSchema);
}
