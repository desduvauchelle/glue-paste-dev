import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanPanel } from "./PlanPanel";

describe("PlanPanel", () => {
  it("renders key files, risks, dependencies", () => {
    render(
      <PlanPanel
        planSummary={{ key_files: ["src/a.ts"], risks: ["flaky test"], dependencies: ["zod"] }}
      />
    );
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("flaky test")).toBeInTheDocument();
    expect(screen.getByText("zod")).toBeInTheDocument();
  });

  it("renders an empty state when no plan summary", () => {
    render(<PlanPanel planSummary={null} />);
    expect(screen.getByText(/no plan summary yet/i)).toBeInTheDocument();
  });
});
