import { describe, expect, it } from "vitest";
import {
  indexContentCourseVersionUsage,
  type ContentUsageRow,
} from "./course-version-usage";

function usageRow(overrides: Partial<ContentUsageRow> = {}): ContentUsageRow {
  return {
    courseId: "course_one",
    courseVersionId: "course_version_one",
    courseTitle: "Course one",
    courseStatus: "published",
    version: 1,
    versionState: "published",
    kind: "scorm",
    learningActivityVersionId: "module_version_one",
    ...overrides,
  };
}

describe("content course-version usage", () => {
  it("indexes each exact content reference", () => {
    const indexed = indexContentCourseVersionUsage([
      usageRow({
        kind: "scorm",
        learningActivityVersionId: "module_version_one",
      }),
      usageRow({
        kind: "resource",
        learningActivityVersionId: "resource_version_one",
      }),
      usageRow({
        kind: "survey",
        learningActivityVersionId: "survey_version_one",
      }),
    ]);

    expect(indexed.modules.get("module_version_one")).toEqual([
      expect.objectContaining({
        courseVersionId: "course_version_one",
        versionState: "published",
      }),
    ]);
    expect(indexed.resources.get("resource_version_one")).toHaveLength(1);
    expect(indexed.surveys.get("survey_version_one")).toHaveLength(1);
  });

  it("deduplicates repeated items within one course version", () => {
    const indexed = indexContentCourseVersionUsage([
      usageRow({
        kind: "scorm",
        learningActivityVersionId: "module_version_one",
      }),
      usageRow({
        kind: "scorm",
        learningActivityVersionId: "module_version_one",
      }),
      usageRow({
        courseId: "course_two",
        courseVersionId: "course_version_two",
        courseTitle: "Course two",
        courseStatus: "archived",
        version: 2,
        versionState: "draft",
        kind: "scorm",
        learningActivityVersionId: "module_version_one",
      }),
    ]);

    expect(indexed.modules.get("module_version_one")).toEqual([
      expect.objectContaining({ courseVersionId: "course_version_one" }),
      expect.objectContaining({
        courseStatus: "archived",
        courseVersionId: "course_version_two",
        versionState: "draft",
      }),
    ]);
  });
});
