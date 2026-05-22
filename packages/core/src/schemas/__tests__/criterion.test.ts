import { describe, it, expect } from "bun:test";
import { CriterionSchema, CreateCriterionSchema } from "../criterion.js";
import { ExecuteReportSchema, PlanReportSchema } from "../report.js";

describe("criterion schemas", () => {
  it("parses a full criterion row with defaults", () => {
    const c = CriterionSchema.parse({
      id: "abc",
      card_id: "card1",
      text: "App builds",
      created_at: "2026-05-22",
      updated_at: "2026-05-22",
    });
    expect(c.status).toBe("pending");
    expect(c.source).toBe("ai");
    expect(c.evidence).toBeNull();
  });

  it("rejects empty create text", () => {
    expect(CreateCriterionSchema.safeParse({ text: "" }).success).toBe(false);
  });
});

describe("report schemas", () => {
  it("parses a plan report", () => {
    const r = PlanReportSchema.parse({
      criteria: ["a", "b"],
      plan_summary: { key_files: ["x.ts"], risks: [], dependencies: [] },
    });
    expect(r.criteria).toHaveLength(2);
  });

  it("parses an execute report with verdicts", () => {
    const r = ExecuteReportSchema.parse({
      criteria: [{ id: "c1", status: "pass", evidence: "tests green" }],
      completion_summary: "done",
      blocker: null,
    });
    const first = r.criteria[0];
    expect(first?.status).toBe("pass");
  });
});
