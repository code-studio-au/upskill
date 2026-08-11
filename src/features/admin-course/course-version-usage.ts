export interface CourseVersionUsage {
  courseId: string;
  courseVersionId: string;
  courseTitle: string;
  courseStatus: "draft" | "published" | "archived";
  version: number;
  versionState: "draft" | "published";
}

export interface ContentCourseVersionUsage {
  modules: Map<string, Array<CourseVersionUsage>>;
  resources: Map<string, Array<CourseVersionUsage>>;
  surveys: Map<string, Array<CourseVersionUsage>>;
}

export interface ContentUsageRow extends CourseVersionUsage {
  kind: "scorm" | "survey" | "resource";
  learningActivityVersionId: string;
}

function addUsage(
  index: Map<string, Array<CourseVersionUsage>>,
  referenceId: string | null,
  row: ContentUsageRow,
): void {
  if (!referenceId) return;
  const usages = index.get(referenceId) ?? [];
  if (usages.some((usage) => usage.courseVersionId === row.courseVersionId))
    return;
  usages.push({
    courseId: row.courseId,
    courseVersionId: row.courseVersionId,
    courseTitle: row.courseTitle,
    courseStatus: row.courseStatus,
    version: row.version,
    versionState: row.versionState,
  });
  index.set(referenceId, usages);
}

export function indexContentCourseVersionUsage(
  rows: ReadonlyArray<ContentUsageRow>,
): ContentCourseVersionUsage {
  const usage: ContentCourseVersionUsage = {
    modules: new Map(),
    resources: new Map(),
    surveys: new Map(),
  };
  for (const row of rows) {
    addUsage(
      row.kind === "scorm"
        ? usage.modules
        : row.kind === "resource"
          ? usage.resources
          : usage.surveys,
      row.learningActivityVersionId,
      row,
    );
  }
  return usage;
}
