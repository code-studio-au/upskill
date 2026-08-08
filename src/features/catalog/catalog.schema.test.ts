import { describe, expect, it } from "vitest";
import {
  catalogSearchSchema,
  courseContentSchema,
  courseSlugSchema,
} from "./catalog.schema";

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

  it("rejects a sale price that is not a real discount", () => {
    expect(() =>
      courseContentSchema.parse({
        title: "Course",
        summary: "Summary",
        description: "Description",
        topic: "leadership",
        durationMinutes: 30,
        priceCents: 10_000,
        salePriceCents: 10_000,
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
      }),
    ).toThrow("Sale price must be lower than the standard price");
  });
});
