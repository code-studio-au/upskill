import { describe, expect, it } from "vitest";
import { filterAutocompleteOptions } from "./lightweight-autocomplete-options";

const options = [
  {
    value: "presenter@example.com",
    label: "Presenter Person",
    description: "NSW Health",
  },
  {
    value: "coordinator@example.com",
    label: "Coordinator Person",
    description: "Victoria Health",
  },
  {
    value: "admin@example.com",
    label: "Event Administrator",
  },
];

describe("lightweight autocomplete filtering", () => {
  it("matches labels, values and descriptions without locale-sensitive casing", () => {
    expect(filterAutocompleteOptions(options, "PRESENTER", 10)).toEqual([
      options[0],
    ]);
    expect(filterAutocompleteOptions(options, "victoria", 10)).toEqual([
      options[1],
    ]);
    expect(filterAutocompleteOptions(options, "admin@", 10)).toEqual([
      options[2],
    ]);
  });

  it("enforces the visible option limit", () => {
    expect(filterAutocompleteOptions(options, "", 2)).toEqual(
      options.slice(0, 2),
    );
  });
});
