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
  mockStatus.mockResolvedValue({ active: false });
});

describe("CaffeineToggle", () => {
  it("renders with inactive state by default", async () => {
    render(<CaffeineToggle />);
    await waitFor(() => {
      expect(mockStatus).toHaveBeenCalled();
    });
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("title", expect.stringContaining("OFF"));
  });

  it("renders with active state when API returns active", async () => {
    mockStatus.mockResolvedValue({ active: true });
    render(<CaffeineToggle />);
    await waitFor(() => {
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", expect.stringContaining("ON"));
    });
  });

  it("calls start when clicking while inactive", async () => {
    mockStatus.mockResolvedValue({ active: false });
    mockStart.mockResolvedValue({ active: true });

    render(<CaffeineToggle />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
  });

  it("calls stop when clicking while active", async () => {
    mockStatus.mockResolvedValue({ active: true });
    mockStop.mockResolvedValue({ active: false });

    render(<CaffeineToggle />);
    await waitFor(() => {
      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("title", expect.stringContaining("ON"));
    });

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
  });

  it("handles API error gracefully by re-fetching status", async () => {
    mockStatus.mockResolvedValue({ active: false });
    mockStart.mockRejectedValue(new Error("Network error"));

    render(<CaffeineToggle />);
    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(1));

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() => expect(mockStatus).toHaveBeenCalledTimes(2));
  });
});
