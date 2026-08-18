import { describe, expect, it } from "vitest";
import {
  consumeFixedWindowRateLimit,
  forwardedClientAddress,
  type FixedWindowRateLimitEntry,
} from "./event-guest-rate-limit";

describe("forwardedClientAddress", () => {
  it("uses the client address before the trusted ALB hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.5, 198.51.100.10",
    });

    expect(forwardedClientAddress(headers)).toBe("203.0.113.5");
  });

  it("ignores caller-supplied addresses before the ALB-appended client", () => {
    const headers = new Headers({
      "x-forwarded-for": "192.0.2.7, 203.0.113.5, 198.51.100.10",
    });

    expect(forwardedClientAddress(headers)).toBe("203.0.113.5");
  });

  it("supports a single forwarding hop in local development", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5" });

    expect(forwardedClientAddress(headers)).toBe("203.0.113.5");
  });
});

describe("consumeFixedWindowRateLimit", () => {
  const options = {
    maximumEntries: 2,
    maximumRequests: 2,
    windowMs: 1_000,
  };

  it("prunes expired entries before enforcing the capacity limit", () => {
    const entries = new Map<string, FixedWindowRateLimitEntry>([
      ["expired-a", { count: 1, resetAt: 99 }],
      ["expired-b", { count: 1, resetAt: 100 }],
    ]);

    expect(consumeFixedWindowRateLimit(entries, "new", 100, options)).toBe(
      true,
    );
    expect([...entries.keys()]).toEqual(["new"]);
  });

  it("rejects new keys only while the live-entry capacity is exhausted", () => {
    const entries = new Map<string, FixedWindowRateLimitEntry>([
      ["live-a", { count: 1, resetAt: 1_100 }],
      ["live-b", { count: 1, resetAt: 1_100 }],
    ]);

    expect(consumeFixedWindowRateLimit(entries, "new", 100, options)).toBe(
      false,
    );
  });

  it("enforces the request limit within a live window", () => {
    const entries = new Map<string, FixedWindowRateLimitEntry>();

    expect(consumeFixedWindowRateLimit(entries, "client", 100, options)).toBe(
      true,
    );
    expect(consumeFixedWindowRateLimit(entries, "client", 200, options)).toBe(
      true,
    );
    expect(consumeFixedWindowRateLimit(entries, "client", 300, options)).toBe(
      false,
    );
  });
});
