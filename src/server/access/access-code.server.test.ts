import { describe, expect, it } from "vitest";
import { formatAccessCode, normalizeAccessCode } from "./access-code.server";

describe("access-code protection", () => {
  it("normalizes presentation separators without weakening the alphabet", () => {
    expect(normalizeAccessCode(" example-learn 2026 ")).toBe(
      "EXAMPLELEARN2026",
    );
    expect(normalizeAccessCode("short")).toBeNull();
    expect(normalizeAccessCode("EXAMPLE_LEARN_2026")).toBeNull();
    expect(normalizeAccessCode("A".repeat(65))).toBeNull();
  });

  it("formats memorable administrator-supplied codes", () => {
    expect(formatAccessCode(" Meal support 2027 ")).toBe("MEAL-SUPPORT-2027");
    expect(formatAccessCode("short")).toBeNull();
  });
});
