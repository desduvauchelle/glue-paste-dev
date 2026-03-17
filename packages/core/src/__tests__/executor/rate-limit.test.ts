import { describe, test, expect } from "bun:test";
import { detectRateLimit } from "../../executor/rate-limit.js";

describe("detectRateLimit", () => {
  test("returns false for successful exit code", () => {
    const result = detectRateLimit("rate limit exceeded", "429", 0);
    expect(result.isRateLimit).toBe(false);
  });

  test("detects 429 in stderr", () => {
    const result = detectRateLimit("", "HTTP 429 Too Many Requests", 1);
    expect(result.isRateLimit).toBe(true);
  });

  test("detects rate limit text in stderr", () => {
    const result = detectRateLimit("", "Error: rate limit exceeded", 1);
    expect(result.isRateLimit).toBe(true);
  });

  test("detects quota exceeded", () => {
    const result = detectRateLimit("", "quota exceeded for model", 1);
    expect(result.isRateLimit).toBe(true);
  });

  test("detects throttling", () => {
    const result = detectRateLimit("Request was throttled", "", 1);
    expect(result.isRateLimit).toBe(true);
  });

  test("detects resource exhausted", () => {
    const result = detectRateLimit("", "RESOURCE_EXHAUSTED: tokens per minute", 1);
    expect(result.isRateLimit).toBe(true);
  });

  test("extracts retry-after time", () => {
    const result = detectRateLimit("", "rate limit exceeded. Retry after 3600 seconds.", 1);
    expect(result.isRateLimit).toBe(true);
    expect(result.resetMessage).toBe("Retry after 3600 seconds");
  });

  test("extracts try again in time", () => {
    const result = detectRateLimit("", "Too many requests. Try again in 2 hours.", 1);
    expect(result.isRateLimit).toBe(true);
    expect(result.resetMessage).toBe("Try again in 2 hours");
  });

  test("extracts wait time", () => {
    const result = detectRateLimit("", "Rate limited. Please wait 30 minutes.", 1);
    expect(result.isRateLimit).toBe(true);
    expect(result.resetMessage).toBe("Wait 30 minutes");
  });

  test("returns default message when no reset time found", () => {
    const result = detectRateLimit("", "429 Too Many Requests", 1);
    expect(result.isRateLimit).toBe(true);
    expect(result.resetMessage).toBe("Check provider dashboard for reset time.");
  });

  test("returns false for unrelated errors", () => {
    const result = detectRateLimit("", "file not found", 1);
    expect(result.isRateLimit).toBe(false);
  });
});
