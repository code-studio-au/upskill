import { describe, expect, it } from "vitest";
import { encodeCsv } from "./csv";

describe("encodeCsv", () => {
  it("quotes RFC 4180 cells and neutralises spreadsheet formulas", () => {
    expect(
      encodeCsv([
        ["name", "note"],
        ['Alex "Example"', "line one\nline two"],
        ['=HYPERLINK("https://example.test")', "+1"],
      ]),
    ).toBe(
      '"name","note"\r\n"Alex ""Example""","line one\nline two"\r\n"\'=HYPERLINK(""https://example.test"")","\'+1"\r\n',
    );
  });
});
