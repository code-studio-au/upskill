import { describe, expect, it } from "vitest";
import {
  adminCourseDraftSchema,
  adminResourceUploadQuerySchema,
} from "./admin-course.schema";

const validDraft = {
  courseId: "course_1",
  versionId: "version_1",
  slug: "strict-course-authoring",
  title: "Strict course authoring",
  summary: "A bounded course summary.",
  description: "A bounded course description.",
  topic: "technology",
  durationMinutes: 30,
  priceCents: 10_000,
  salePriceCents: 8_000,
  featured: false,
  listInStore: true,
  hasCompletionCertificate: false,
  prerequisites: [],
  accreditations: [],
  sections: [
    {
      id: "section_1",
      title: "First section",
      description: "Preparation",
      items: [
        {
          id: "item_1",
          kind: "resource",
          title: "Reference guide",
          required: true,
          durationMinutes: null,
          resourceVersionId: "resource_version_1",
        },
      ],
    },
  ],
} as const;

describe("admin course authoring inputs", () => {
  it("accepts exact version references in ordered sections", () => {
    expect(adminCourseDraftSchema.parse(validDraft)).toMatchObject({
      slug: "strict-course-authoring",
      sections: [{ items: [{ kind: "resource" }] }],
    });
  });

  it("rejects duplicate section and item identifiers", () => {
    expect(() =>
      adminCourseDraftSchema.parse({
        ...validDraft,
        sections: [
          validDraft.sections[0],
          {
            ...validDraft.sections[0],
            title: "Duplicate identifiers",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects sale prices that do not reduce the standard price", () => {
    expect(() =>
      adminCourseDraftSchema.parse({
        ...validDraft,
        salePriceCents: validDraft.priceCents,
      }),
    ).toThrow();
  });

  it("requires bounded PDF upload metadata and a safe display name", () => {
    expect(
      adminResourceUploadQuerySchema.parse({
        title: "Reference guide",
        description: "A private PDF resource.",
        displayName: "reference-guide.pdf",
      }),
    ).toEqual({
      title: "Reference guide",
      description: "A private PDF resource.",
      displayName: "reference-guide.pdf",
    });
    expect(() =>
      adminResourceUploadQuerySchema.parse({
        title: "Reference guide",
        description: "",
        displayName: "",
      }),
    ).toThrow();
  });
});
