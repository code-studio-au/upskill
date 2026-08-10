import { Link } from "@tanstack/react-router";
import type { AdminCourseDetail } from "./admin-course.schema";
import classes from "./AdminCourseRoster.module.css";

type Roster = AdminCourseDetail["roster"];

export function AdminCourseRoster({ roster }: { roster: Roster }) {
  return (
    <section aria-labelledby="course-roster-heading" className={classes.root}>
      <header className={classes.header}>
        <div>
          <h2 id="course-roster-heading" className={classes.heading}>
            Learner roster
          </h2>
          <p className={classes.description}>
            Review each learner against the exact course version they received.
          </p>
        </div>
        <span className={classes.count}>
          {roster.total} {roster.total === 1 ? "enrolment" : "enrolments"}
        </span>
      </header>

      {roster.enrollments.length === 0 ? (
        <p className={classes.empty}>This course has no learner enrolments.</p>
      ) : (
        <div className={classes.rosterGrid}>
          {roster.enrollments.map((enrollment) => (
            <article
              className={classes.rosterCard}
              key={enrollment.enrollmentId}
            >
              <div className={classes.cardHeader}>
                <div className={classes.identity}>
                  <h3 className={classes.learnerName}>
                    {enrollment.learnerName}
                  </h3>
                  <p className={classes.email}>{enrollment.learnerEmail}</p>
                </div>
                <span className={classes.state} data-state={enrollment.state}>
                  {enrollment.state}
                </span>
              </div>
              <p className={classes.details}>
                Version {enrollment.courseVersion} · Enrolled{" "}
                {enrollment.enrolledAtLabel}
                {enrollment.statusDateLabel
                  ? ` · ${enrollment.statusDateLabel}`
                  : ""}
              </p>
              <Link
                to="/admin/learners/$userId/enrollments/$enrollmentId"
                params={{
                  userId: enrollment.learnerId,
                  enrollmentId: enrollment.enrollmentId,
                }}
                className={classes.actionLink}
              >
                Review learner progress
              </Link>
            </article>
          ))}
        </div>
      )}

      {roster.total > roster.limit ? (
        <p className={classes.description}>
          Showing the {roster.limit} most recent enrolments. Use learner search
          to find older records.
        </p>
      ) : null}
    </section>
  );
}
