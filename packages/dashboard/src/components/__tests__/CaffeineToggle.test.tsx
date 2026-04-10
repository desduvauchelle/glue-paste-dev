import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CaffeineToggle } from "../CaffeineToggle";

vi.mock("@/lib/api", () => ({
  caffeinate: {
    status: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

import { caffeinate } from "@/lib/api";

const mockStatus = caffeinate.status as ReturnType<typeof vi.fn>;
const mockStart = caffeinate.start as ReturnType<typeof vi.fn>;
const mockStop = caffeinate.stop as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue({ active: false, activeBoards: [] });
});

describe("CaffeineToggle", () => {
  it("renders with inactive state by default", async () => {
    render(<CaffeineToggle />);
    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    const button = screen.getByRole("button");
    expect(button).toBeDefined();
    // Tooltip content shows OFF state
    expect(screen.getByText(/Caffeinate: OFF/)).toBeDefined();
  });

  it("renders with active state when API returns active", async () => {
    mockStatus.mockResolvedValue({ active: true, activeBoards: [] });
    render(<CaffeineToggle />);
    await waitFor(() => {
      expect(screen.getByText(/Caffeinate: ON/)).toBeDefined();
    });
  });

  it("shows active board names in tooltip when active with boards", async () => {
    mockStatus.mockResolvedValue({
      active: true,
      activeBoards: [{ id: "1", name: "My Project" }],
    });
    render(<CaffeineToggle />);
    await waitFor(() => {
      expect(screen.getByText(/Keeping awake: My Project/)).toBeDefined();
    });
  });

  it("calls start when clicking while inactive", async () => {
    mockStatus.mockResolvedValue({ active: false, activeBoards: [] });
    mockStart.mockResolvedValue({ active: true });

    render(<CaffeineToggle />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("calls stop when clicking while active", async () => {
    mockStatus.mockResolvedValue({ active: true, activeBoards: [] });
    mockStop.mockResolvedValue({ active: false });

    render(<CaffeineToggle />);
    await waitFor(() => {
      expect(screen.getByText(/Caffeinate: ON/)).toBeDefined();
    });

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
  });

  it("handles API error gracefully by re-fetching status", async () => {
    mockStatus.mockResolvedValue({ active: false, activeBoards: [] });
    mockStart.mockRejectedValue(new Error("Network error"));

    render(<CaffeineToggle />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(1));

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(2));
  });
});
