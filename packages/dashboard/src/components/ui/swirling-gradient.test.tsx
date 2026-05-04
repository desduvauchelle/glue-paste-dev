import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SwirlGradient } from "./swirling-gradient";

describe("SwirlGradient", () => {
  it("renders a canvas element", () => {
    const { container } = render(<SwirlGradient />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(<SwirlGradient className="my-bg" />);
    expect(container.querySelector("canvas")).toHaveClass("my-bg");
  });

  it("accepts custom color props without error", () => {
    expect(() =>
      render(<SwirlGradient color1="#333333" color2="#cccccc" />),
    ).not.toThrow();
  });
});
