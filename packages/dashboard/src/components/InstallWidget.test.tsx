import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InstallWidget } from "./InstallWidget";

function makeLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage());
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe("InstallWidget", () => {
  it("shows macOS instructions when on Mac", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      configurable: true,
    });
    render(<InstallWidget />);
    expect(screen.getByText(/using Safari/)).toBeInTheDocument();
    expect(screen.getByText(/Add to Dock/)).toBeInTheDocument();
  });

  it("shows Windows instructions when on Windows", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      configurable: true,
    });
    render(<InstallWidget />);
    expect(screen.getByText(/using Edge/)).toBeInTheDocument();
    expect(screen.getByText(/Install this site as an app/)).toBeInTheDocument();
  });

  it("hides when dismissed and persists to localStorage", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    const { container } = render(<InstallWidget />);
    expect(screen.getByText(/using Safari/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss install suggestion"));
    expect(container.innerHTML).toBe("");
    expect(localStorage.getItem("glue-install-widget-dismissed")).toBe("true");
  });

  it("does not render when already dismissed", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    localStorage.setItem("glue-install-widget-dismissed", "true");
    const { container } = render(<InstallWidget />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render when in standalone mode", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(display-mode: standalone)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const { container } = render(<InstallWidget />);
    expect(container.innerHTML).toBe("");
  });

  it("does not render for unknown platforms", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64)",
      configurable: true,
    });
    const { container } = render(<InstallWidget />);
    expect(container.innerHTML).toBe("");
  });
});
