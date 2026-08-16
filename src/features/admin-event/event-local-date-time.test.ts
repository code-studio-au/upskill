import { describe, expect, it } from "vitest";
import {
  formatEventLocalDateTime,
  maskEventLocalDateTime,
  parseEventLocalDateTime,
} from "./event-local-date-time";

describe("event local date-time display", () => {
  it("formats local ISO values as Australian date and 24-hour time", () => {
    expect(formatEventLocalDateTime("2026-08-23T09:05")).toBe(
      "23/08/2026 09:05",
    );
  });

  it("parses valid display values without applying a timezone", () => {
    expect(parseEventLocalDateTime("23/08/2026 09:05")).toBe(
      "2026-08-23T09:05",
    );
    expect(parseEventLocalDateTime("29/02/2028 23:59")).toBe(
      "2028-02-29T23:59",
    );
  });

  it("rejects impossible dates and times", () => {
    expect(parseEventLocalDateTime("29/02/2027 09:00")).toBeNull();
    expect(parseEventLocalDateTime("23/08/2026 24:00")).toBeNull();
    expect(parseEventLocalDateTime("08/23/2026 09:00")).toBeNull();
  });

  it("masks typed digits into the display format", () => {
    expect(maskEventLocalDateTime("230820260905")).toBe("23/08/2026 09:05");
    expect(maskEventLocalDateTime("23/08/2026 09:05")).toBe("23/08/2026 09:05");
  });
});
