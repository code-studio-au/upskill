import { describe, expect, it } from "vitest";
import {
  mergeContractIdentityValues,
  normalizeContractIdentityValue,
} from "./contract-identity-values";

describe("contract identity values", () => {
  it("normalizes a typed identity", () => {
    expect(normalizeContractIdentityValue("  OWNER@Example.ORG ")).toBe(
      "owner@example.org",
    );
  });

  it("includes a pending input value when the form is submitted", () => {
    expect(
      mergeContractIdentityValues(
        ["existing.example.org"],
        " New.Example.ORG ",
      ),
    ).toEqual(["existing.example.org", "new.example.org"]);
  });

  it("removes duplicate and blank pending input values", () => {
    expect(
      mergeContractIdentityValues(["owner@example.org"], " OWNER@example.org "),
    ).toEqual(["owner@example.org"]);
    expect(mergeContractIdentityValues(["owner@example.org"], "  ")).toEqual([
      "owner@example.org",
    ]);
  });
});
