import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseReportJson, writeReportFile } from "../../executor/extract-report.js";
import { ExecuteReportSchema } from "../../schemas/report.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("parseReportJson", () => {
  it("parses a fenced json block", () => {
    const text = "blah blah\n```json\n{\"criteria\":[{\"id\":\"c1\",\"status\":\"pass\",\"evidence\":\"ok\"}],\"completion_summary\":\"done\",\"blocker\":null}\n```\nmore";
    const parsed = parseReportJson(text, ExecuteReportSchema);
    expect(parsed?.criteria[0]?.id).toBe("c1");
  });

  it("parses a bare json object", () => {
    const text = "{\"criteria\":[],\"completion_summary\":\"\",\"blocker\":null}";
    expect(parseReportJson(text, ExecuteReportSchema)).not.toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseReportJson("not json at all", ExecuteReportSchema)).toBeNull();
  });
});

describe("writeReportFile", () => {
  it("writes JSON under .glue-paste/reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "gpd-"));
    tmpDirs.push(dir);
    writeReportFile(dir, "exec123", { hello: "world" });
    const file = join(dir, ".glue-paste", "reports", "exec123.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).hello).toBe("world");
  });
});
