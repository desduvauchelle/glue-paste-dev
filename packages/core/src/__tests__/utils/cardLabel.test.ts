import { describe, it, expect } from "bun:test";
import { cardLabel } from "../../utils/cardLabel.js";

describe("cardLabel", () => {
  it("returns title when present", () => {
    expect(cardLabel({ title: "My Task", description: "Some description" })).toBe("My Task");
  });

  it("returns description truncated to 60 chars when title is empty", () => {
    const desc = "A".repeat(80);
    const result = cardLabel({ title: "", description: desc });
    expect(result).toBe("A".repeat(60) + "...");
  });

  it("returns full description when under 60 chars and no title", () => {
    expect(cardLabel({ title: "", description: "Short desc" })).toBe("Short desc");
  });

  it("returns empty string when both are empty", () => {
    expect(cardLabel({ title: "", description: "" })).toBe("");
  });
});
