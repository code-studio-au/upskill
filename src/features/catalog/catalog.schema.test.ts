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
        topic: "x".repeat(81),
        page: "-2",
      }),
    ).toEqual({ q: "safety", topic: "all", page: 1 });
  });

  it("accepts custom catalogue topics", () => {
    expect(
      catalogSearchSchema.parse({
        q: "",
        topic: "Eating disorder treatment",
        page: 1,
      }),
    ).toEqual({ q: "", topic: "Eating disorder treatment", page: 1 });
  });

  it("accepts a versioned private cover-image reference", () => {
    const content = courseContentSchema.parse({
      title: "Course",
      summary: "Summary",
      description: "Description",
      topic: "Clinical education",
      durationMinutes: 30,
      priceCents: 10_000,
      salePriceCents: null,
      currency: "AUD",
      featured: false,
      listInStore: true,
      coverImage: {
        assetId: "offering_image_example",
        altText: "Clinicians working together",
      },
      hasCompletionCertificate: false,
      prerequisites: [],
      accreditations: [],
      modules: [],
    });
    expect(content.coverImage).toEqual({
      assetId: "offering_image_example",
      altText: "Clinicians working together",
    });
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

  it("defaults legacy accreditation entries without losing their claims", () => {
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
      hasCompletionCertificate: true,
      prerequisites: [],
      accreditations: [{ name: "CPD", cpdPoints: 2 }],
      modules: [],
    });
    expect(content.accreditations).toEqual([
      {
        name: "CPD",
        cpdPoints: 2,
        blurb: "",
        logoAssetId: null,
        logoName: "",
      },
    ]);
  });

  it("accepts only bounded custom accreditation logo references", () => {
    const base = {
      name: "Example accreditation",
      cpdPoints: null,
      blurb: "Accreditation statement",
    };
    expect(
      courseContentSchema.shape.accreditations.safeParse([
        {
          ...base,
          logoAssetId: "accreditation_logo_example",
          logoName: "Example logo",
        },
      ]).success,
    ).toBe(true);
    expect(
      courseContentSchema.shape.accreditations.safeParse([
        { ...base, logoAssetId: "accreditation_logo_example" },
      ]).success,
    ).toBe(false);
    expect(
      courseContentSchema.shape.accreditations.safeParse([
        {
          ...base,
          logoAssetId: "untrusted-logo-reference",
          logoName: "Example logo",
        },
      ]).success,
    ).toBe(false);
  });

  it("bounds accreditations to a legible single-page certificate", () => {
    const accreditation = {
      name: "Example accreditation",
      cpdPoints: 1,
      blurb: "Accreditation statement",
      logoAssetId: null,
      logoName: "",
    };
    expect(
      courseContentSchema.shape.accreditations.safeParse(
        Array.from({ length: 5 }, () => accreditation),
      ).success,
    ).toBe(true);
    expect(
      courseContentSchema.shape.accreditations.safeParse(
        Array.from({ length: 6 }, () => accreditation),
      ).success,
    ).toBe(false);
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
