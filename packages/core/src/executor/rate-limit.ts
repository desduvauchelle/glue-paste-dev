/**
 * Detects rate-limit / quota errors from CLI provider output
 * and extracts reset time info when available.
 */

export interface RateLimitInfo {
  isRateLimit: boolean;
  resetMessage?: string;
}

const RATE_LIMIT_PATTERNS = [
  /rate.limit/i,
  /429/,
  /too many requests/i,
  /quota.exceeded/i,
  /resource.exhausted/i,
  /overloaded/i,
  /capacity/i,
  /throttl/i,
  /usage.limit/i,
  /request limit/i,
  /token limit/i,
  /exceeded.*limit/i,
  /limit.*exceeded/i,
];

const RESET_PATTERNS: { pattern: RegExp; extract: (m: RegExpMatchArray) => string }[] = [
  {
    pattern: /retry.after[:\s]+(\d+)\s*(seconds?|minutes?|hours?)/i,
    extract: (m) => `Retry after ${m[1]} ${m[2]}`,
  },
  {
    pattern: /try again in\s+(.+?)[.\n]/i,
    extract: (m) => `Try again in ${m[1]}`,
  },
  {
    pattern: /wait\s+(\d+)\s*(seconds?|minutes?|hours?)/i,
    extract: (m) => `Wait ${m[1]} ${m[2]}`,
  },
  {
    pattern: /resets?\s+(?:at|in)\s+(.+?)[.\n]/i,
    extract: (m) => `Resets ${m[1]}`,
  },
  {
    pattern: /available.(?:again|in)\s+(.+?)[.\n]/i,
    extract: (m) => `Available ${m[1]}`,
  },
];

export function detectRateLimit(stdout: string, stderr: string, exitCode: number): RateLimitInfo {
  // Only check failures
  if (exitCode === 0) return { isRateLimit: false };

  const combined = `${stderr}\n${stdout}`;

  const isRateLimit = RATE_LIMIT_PATTERNS.some((p) => p.test(combined));
  if (!isRateLimit) return { isRateLimit: false };

  // Try to extract reset time
  for (const { pattern, extract } of RESET_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      return { isRateLimit: true, resetMessage: extract(match) };
    }
  }

  return { isRateLimit: true, resetMessage: "Check provider dashboard for reset time." };
}
