import { describe, expect, it } from "vitest";
import {
  createEventTimezoneOptions,
  resolveEventTimezoneInput,
} from "./event-timezones";

describe("createEventTimezoneOptions", () => {
  it("provides canonical timezone values with readable labels", () => {
    const options = createEventTimezoneOptions("Australia/Sydney");
    expect(options).toContainEqual({
      value: "Australia/Sydney",
      label: "Sydney — Australia",
    });
    expect(options).toContainEqual({ value: "UTC", label: "UTC" });
  });

  it("retains a valid stored alias that is absent from the canonical list", () => {
    expect(createEventTimezoneOptions("Etc/UTC")).toContainEqual({
      value: "Etc/UTC",
      label: "UTC — Etc",
    });
  });

  it("resolves a friendly city label to its canonical timezone", () => {
    const options = createEventTimezoneOptions("Australia/Sydney");
    expect(resolveEventTimezoneInput("Sydney — Australia", options)).toBe(
      "Australia/Sydney",
    );
    expect(resolveEventTimezoneInput("sydney — australia", options)).toBe(
      "Australia/Sydney",
    );
  });

  it("leaves unmatched input for schema validation", () => {
    expect(resolveEventTimezoneInput("Anywhere", [])).toBe("Anywhere");
  });
});
