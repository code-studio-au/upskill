import { describe, expect, it } from "vitest";
import {
  catalogSearchSchema,
  courseContentSchema,
  courseSlugSchema,
  resolveBulkUnitPrice,
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

  it("defaults legacy course content to disabled bulk pricing", () => {
    const content = courseContentSchema.parse({
      title: "Course",
      summary: "Summary",
      description: "Description",
      topic: "leadership",
      durationMinutes: 30,
      priceCents: 10_000,
      salePriceCents: null,
      currency: "AUD",
      featured: false,
      listInStore: true,
      hasCompletionCertificate: false,
      prerequisites: [],
      accreditations: [],
      modules: [],
    });
    expect(content.bulkPricing).toEqual({ enabled: false, tiers: [] });
  });

  it("resolves the highest reached immutable bulk-pricing tier", () => {
    const pricing = {
      enabled: true,
      tiers: [
        { minimumQuantity: 5, unitPriceCents: 8_000 },
        { minimumQuantity: 20, unitPriceCents: 7_000 },
      ],
    };
    expect(resolveBulkUnitPrice(pricing, 4)).toBeNull();
    expect(resolveBulkUnitPrice(pricing, 5)).toBe(8_000);
    expect(resolveBulkUnitPrice(pricing, 25)).toBe(7_000);
  });

  it("rejects unordered or non-discounted bulk-pricing tiers", () => {
    expect(() =>
      courseContentSchema.parse({
        title: "Course",
        summary: "Summary",
        description: "Description",
        topic: "leadership",
        durationMinutes: 30,
        priceCents: 10_000,
        salePriceCents: null,
        bulkPricing: {
          enabled: true,
          tiers: [
            { minimumQuantity: 10, unitPriceCents: 8_000 },
            { minimumQuantity: 5, unitPriceCents: 8_000 },
          ],
        },
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
      }),
    ).toThrow();
  });
});
