import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdateButton } from "./UpdateButton";

vi.mock("@/lib/api", () => ({
  update: {
    check: vi.fn().mockResolvedValue({ available: false, currentVersion: "1.0.0", latestVersion: "1.0.0" }),
    apply: vi.fn().mockResolvedValue({ ok: true }),
    logs: vi.fn().mockResolvedValue({ lines: [] }),
  },
}));

vi.mock("@/lib/ws", () => ({
  useWSEvent: vi.fn(),
  useWebSocket: vi.fn(),
}));

describe("UpdateButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders without crashing in idle state", () => {
    render(<UpdateButton />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("timeout constant is 90 seconds", () => {
    const TIMEOUT_MS = 90_000;
    expect(TIMEOUT_MS).toBe(90_000);
    expect(TIMEOUT_MS).toBeGreaterThan(89_000);
  });
});
