import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SparklesText } from "./sparkles-text";

describe("SparklesText", () => {
  it("renders the text content", () => {
    render(<SparklesText text="Hello World" />);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <SparklesText text="Test" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("accepts custom colors without error", () => {
    expect(() =>
      render(
        <SparklesText
          text="Colored"
          colors={{ first: "#ff0000", second: "#0000ff" }}
        />,
      ),
    ).not.toThrow();
  });
});
