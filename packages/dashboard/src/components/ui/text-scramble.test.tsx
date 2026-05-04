import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TextScramble } from "./text-scramble";

// jsdom doesn't implement requestAnimationFrame — provide a no-op stub
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (_cb: FrameRequestCallback) => 0);
  vi.stubGlobal("cancelAnimationFrame", (_id: number) => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TextScramble", () => {
  it("renders without crashing", () => {
    expect(() =>
      render(<TextScramble phrases={["Hello", "World"]} />),
    ).not.toThrow();
  });

  it("renders a container div", () => {
    const { container } = render(<TextScramble phrases={["Hello"]} />);
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("accepts all optional props without error", () => {
    const onComplete = vi.fn();
    expect(() =>
      render(
        <TextScramble
          phrases={["Foo", "Bar"]}
          chars="ABC123"
          pauseMs={500}
          autoStart={false}
          loop={false}
          textClass="text-lg text-red-500"
          dudClass="text-red-200"
          onPhraseComplete={onComplete}
        />,
      ),
    ).not.toThrow();
  });

  it("applies textClass to the inner text element", () => {
    const { container } = render(
      <TextScramble phrases={["Test"]} textClass="my-text-class" />,
    );
    expect(container.querySelector(".my-text-class")).not.toBeNull();
  });
});
