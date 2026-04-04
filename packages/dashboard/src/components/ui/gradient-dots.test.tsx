import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GradientDots } from "./gradient-dots";

describe("GradientDots", () => {
  it("renders without crashing", () => {
    expect(() => render(<GradientDots />)).not.toThrow();
  });

  it("applies custom className", () => {
    const { container } = render(<GradientDots className="my-custom" />);
    expect(container.firstChild).toHaveClass("my-custom");
  });

  it("accepts custom prop values without error", () => {
    expect(() =>
      render(
        <GradientDots
          dotSize={12}
          spacing={15}
          duration={60}
          colorCycleDuration={8}
          backgroundColor="#000"
        />,
      ),
    ).not.toThrow();
  });
});
