import { describe, expect, it } from "vitest";
import { boundByteRange, parseByteRange } from "./byte-range";

describe("byte range parsing", () => {
  it.each([
    [null, { status: "none" }],
    ["bytes=100-200", { status: "valid", value: "bytes=100-200" }],
    ["bytes=100-", { status: "valid", value: "bytes=100-" }],
    ["bytes=-200", { status: "valid", value: "bytes=-200" }],
    ["bytes=", { status: "invalid" }],
    ["bytes=200-100", { status: "invalid" }],
    ["bytes=0-1,5-6", { status: "invalid" }],
    ["items=0-10", { status: "invalid" }],
  ])("parses %s", (value, expected) => {
    expect(parseByteRange(value)).toEqual(expected);
  });

  it.each([
    ["bytes=100-", 1_000, "bytes=100-1099"],
    ["bytes=100-5000", 1_000, "bytes=100-1099"],
    ["bytes=100-200", 1_000, "bytes=100-200"],
    ["bytes=-5000", 1_000, "bytes=-1000"],
    ["bytes=-200", 1_000, "bytes=-200"],
  ])("bounds %s to %i bytes", (range, maximumBytes, expected) => {
    expect(boundByteRange(range, maximumBytes)).toBe(expected);
  });

  it("rejects invalid ranges and limits", () => {
    expect(() => boundByteRange("bytes=", 1_000)).toThrow("invalid");
    expect(() => boundByteRange("bytes=0-", 0)).toThrow("positive integer");
  });
});
