import { describe, expect, it } from "vitest";
import {
  formatSurveyLocalDate,
  maskSurveyLocalDate,
  parseSurveyLocalDate,
} from "./survey-local-date";

describe("survey local dates", () => {
  it("formats ISO dates as DD/MM/YYYY", () => {
    expect(formatSurveyLocalDate("2026-08-23")).toBe("23/08/2026");
  });

  it("parses valid DD/MM/YYYY dates to ISO dates", () => {
    expect(parseSurveyLocalDate("23/08/2026")).toBe("2026-08-23");
    expect(parseSurveyLocalDate("29/02/2028")).toBe("2028-02-29");
  });

  it("rejects impossible and American-formatted dates", () => {
    expect(parseSurveyLocalDate("29/02/2027")).toBeNull();
    expect(parseSurveyLocalDate("08/23/2026")).toBeNull();
  });

  it("masks numeric input as DD/MM/YYYY", () => {
    expect(maskSurveyLocalDate("23082026")).toBe("23/08/2026");
  });
});
