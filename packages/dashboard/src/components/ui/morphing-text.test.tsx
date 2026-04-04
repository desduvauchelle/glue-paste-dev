import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { MorphingText } from "./morphing-text";

describe("MorphingText", () => {
  it("renders without error with a texts array", () => {
    expect(() =>
      render(<MorphingText texts={["Hello", "World"]} />),
    ).not.toThrow();
  });

  it("applies custom className to the container", () => {
    const { container } = render(
      <MorphingText texts={["Hello", "World"]} className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("renders the SVG threshold filter", () => {
    const { container } = render(<MorphingText texts={["Hello"]} />);
    expect(container.querySelector("filter#threshold")).not.toBeNull();
  });

  it("renders two span elements for the morphing text", () => {
    const { container } = render(<MorphingText texts={["A", "B"]} />);
    expect(container.querySelectorAll("span").length).toBeGreaterThanOrEqual(2);
  });
});
