import { describe, expect, it } from "vitest";
import { digestAccessCode, normalizeAccessCode } from "./access-code.server";

describe("access-code protection", () => {
  it("normalizes presentation separators without weakening the alphabet", () => {
    expect(normalizeAccessCode(" example-learn 2026 ")).toBe(
      "EXAMPLELEARN2026",
    );
    expect(normalizeAccessCode("short")).toBeNull();
    expect(normalizeAccessCode("EXAMPLE_LEARN_2026")).toBeNull();
    expect(normalizeAccessCode("A".repeat(65))).toBeNull();
  });

  it("creates deterministic, pepper-bound digests without retaining the code", () => {
    const first = digestAccessCode("EXAMPLE-LEARN-2026", "a".repeat(32));
    const equivalent = digestAccessCode("example learn 2026", "a".repeat(32));
    const differentPepper = digestAccessCode(
      "EXAMPLE-LEARN-2026",
      "b".repeat(32),
    );

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(equivalent).toBe(first);
    expect(differentPepper).not.toBe(first);
    expect(first).not.toContain("EXAMPLE");
  });
});
