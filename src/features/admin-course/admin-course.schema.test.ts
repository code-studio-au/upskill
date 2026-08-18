import { describe, expect, it } from "vitest";
import {
  adminCourseDraftSchema,
  adminCourseEnrollmentCreateSchema,
  adminCourseEnrollmentRemoveSchema,
} from "./admin-course.schema";
import {
  adminResourceUploadFormSchema,
  adminResourceUploadQuerySchema,
} from "#/features/resource/resource.schema";

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
  bulkPricing: { enabled: false, tiers: [] },
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

  it("returns an actionable message when no PDF is selected", () => {
    const result = adminResourceUploadFormSchema.safeParse({
      title: "Learner guide",
      description: "",
      document: null,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe("Choose a PDF document.");
  });

  it("validates bounded administrator enrolment commands", () => {
    expect(
      adminCourseEnrollmentCreateSchema.parse({
        courseId: "course_1",
        courseVersionId: "version_1",
        learnerEmail: "learner@example.com",
      }),
    ).toEqual({
      courseId: "course_1",
      courseVersionId: "version_1",
      learnerEmail: "learner@example.com",
    });
    expect(
      adminCourseEnrollmentRemoveSchema.parse({
        courseId: "course_1",
        enrollmentId: "enrollment_1",
      }),
    ).toEqual({ courseId: "course_1", enrollmentId: "enrollment_1" });
    expect(() =>
      adminCourseEnrollmentCreateSchema.parse({
        courseId: "course_1",
        courseVersionId: "version_1",
        learnerEmail: "not-an-email",
      }),
    ).toThrow("Enter a valid learner email address.");
  });
});
