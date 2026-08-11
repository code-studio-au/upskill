import { describe, expect, it } from "vitest";
import {
  extractAccessCodeLookupId,
  formatAccessCode,
  issueAccessCode,
  normalizeAccessCode,
} from "./access-code.server";

describe("access-code protection", () => {
  it("normalizes presentation separators without weakening the alphabet", () => {
    expect(normalizeAccessCode(" example-learn 2026 ")).toBe(
      "EXAMPLELEARN2026",
    );
    expect(normalizeAccessCode("short")).toBeNull();
    expect(normalizeAccessCode("EXAMPLE_LEARN_2026")).toBeNull();
    expect(normalizeAccessCode("A".repeat(81))).toBeNull();
  });

  it("formats memorable administrator-supplied codes", () => {
    expect(formatAccessCode(" Meal support 2027 ")).toBe("MEAL-SUPPORT-2027");
    expect(formatAccessCode("short")).toBeNull();
  });

  it("appends and extracts an unambiguous public lookup segment", () => {
    expect(issueAccessCode(" Meal support 2027 ", "K7M4P9Q2WX")).toEqual({
      accessCode: "MEAL-SUPPORT-2027-K7M4P9Q2WX",
      lookupId: "K7M4P9Q2WX",
    });
    expect(extractAccessCodeLookupId("meal support 2027 k7m4p9q2wx")).toBe(
      "K7M4P9Q2WX",
    );
    expect(issueAccessCode("Meal support 2027", "AMBIGI0US1")).toBeNull();
    expect(extractAccessCodeLookupId("MEAL-SUPPORT-2027")).toBeNull();
  });
});
