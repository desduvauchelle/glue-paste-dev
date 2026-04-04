import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ShaderBackground } from "./shader-background";

describe("ShaderBackground", () => {
  it("renders without crashing", () => {
    expect(() => render(<ShaderBackground />)).not.toThrow();
  });

  it("applies custom className to the container", () => {
    const { container } = render(<ShaderBackground className="my-bg" />);
    expect(container.firstChild).toHaveClass("my-bg");
  });

  it("renders a canvas element", () => {
    const { container } = render(<ShaderBackground />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });

  it("accepts optional pixelRatio prop without error", () => {
    expect(() => render(<ShaderBackground pixelRatio={1} />)).not.toThrow();
  });
});
