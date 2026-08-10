import { Link } from "@tanstack/react-router";
import type { CourseVersionUsage } from "./course-version-usage";
import classes from "./CourseVersionUsageList.module.css";

export function CourseVersionUsageList({
  contentVersion,
  usages,
}: {
  contentVersion?: number;
  usages: ReadonlyArray<CourseVersionUsage>;
}) {
  if (!usages.length) return null;

  return (
    <ul className={classes.list}>
      {usages.map((usage) => (
        <li className={classes.item} key={usage.courseVersionId}>
          <Link
            className={classes.link}
            to="/admin/courses/$courseId"
            params={{ courseId: usage.courseId }}
          >
            {contentVersion ? `Survey v${String(contentVersion)} → ` : ""}
            {usage.courseTitle} — v{usage.version} {usage.versionState}
            {usage.courseStatus === "archived" ? " · archived" : ""}
          </Link>
        </li>
      ))}
    </ul>
  );
}
