import { describe, expect, it } from "vitest";
import { normalizeInternationalPhone } from "./phone-number";

describe("normalizeInternationalPhone", () => {
  it("canonicalizes common international display formatting", () => {
    expect(normalizeInternationalPhone(" +61 (400) 000-000 ")).toBe(
      "+61400000000",
    );
    expect(normalizeInternationalPhone("+61.400.000.000")).toBe("+61400000000");
  });

  it("rejects local, malformed and overlong numbers", () => {
    expect(normalizeInternationalPhone("0400 000 000")).toBeNull();
    expect(normalizeInternationalPhone("+0123456789")).toBeNull();
    expect(normalizeInternationalPhone("+1234567")).toBeNull();
    expect(normalizeInternationalPhone("+1234567890123456")).toBeNull();
  });
});
