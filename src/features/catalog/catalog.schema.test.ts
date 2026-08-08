import { describe, expect, it } from "vitest";
import { catalogSearchSchema, courseSlugSchema } from "./catalog.schema";

describe("catalog input", () => {
  it("normalizes invalid search values to safe defaults", () => {
    expect(
      catalogSearchSchema.parse({
        q: "  safety ",
        topic: "invalid",
        page: "-2",
      }),
    ).toEqual({ q: "safety", topic: "all", page: 1 });
  });

  it("rejects a path-like slug", () => {
    expect(() => courseSlugSchema.parse({ slug: "../admin" })).toThrow();
  });
});
