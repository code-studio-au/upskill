import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byte-range";

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
});
