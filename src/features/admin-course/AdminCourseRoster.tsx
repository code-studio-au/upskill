import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { formatLocalDate } from "#/features/shared/local-date";
import { useMemo, useState } from "react";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { firstFormError } from "#/features/shared/form-errors";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  addAdminCourseEnrollment,
  removeAdminCourseEnrollment,
} from "#/server/functions/admin-course";
import {
  adminCourseEnrollmentCreateSchema,
  type AdminCourseDetail,
} from "./admin-course.schema";
import classes from "./AdminCourseRoster.module.css";

interface AdminCourseRosterProps {
  detail: AdminCourseDetail;
  onChanged: () => Promise<void>;
}

type RosterEnrollment = AdminCourseDetail["roster"]["enrollments"][number];

export function AdminCourseRoster({
  detail,
  onChanged,
}: AdminCourseRosterProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RosterEnrollment | null>(null);
  const [removalPending, setRemovalPending] = useState(false);
  const publishedVersions = useMemo(
    () => detail.versions.filter((version) => version.publishedAt !== null),
    [detail.versions],
  );
  const enrollmentForm = useForm({
    defaultValues: {
      courseId: detail.course.id,
      courseVersionId: publishedVersions[0]?.id ?? "",
      learnerEmail: "",
    },
    validators: { onSubmit: adminCourseEnrollmentCreateSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminCourseEnrollmentCreateSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      setMessage(null);
      const result = await addAdminCourseEnrollment({ data: parsed.data });
      if (result.status === "not-found") {
        setError(
          result.entity === "learner"
            ? "No learner account matches that email address."
            : "Choose a published course version that is still available.",
        );
        return;
      }
      if (result.status === "conflict") {
        setError("That learner already has access to this course version.");
        return;
      }
      if (result.status !== "ready") {
        setError("The learner could not be enrolled. Refresh and try again.");
        return;
      }
      enrollmentForm.setFieldValue("learnerEmail", "");
      setMessage(
        result.data.outcome === "restored"
          ? "Learner access restored. Existing progress and completion history were retained."
          : "Learner enrolled in the selected published course version.",
      );
      await onChanged();
    },
  });

  async function confirmRemoval(): Promise<void> {
    if (!removal) return;
    setRemovalPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await removeAdminCourseEnrollment({
        data: {
          courseId: detail.course.id,
          enrollmentId: removal.enrollmentId,
        },
      });
      if (result.status !== "ready") {
        setError("Learner access could not be removed. Refresh and try again.");
        return;
      }
      setMessage(
        result.data.outcome === "unchanged"
          ? "Learner access was already removed."
          : "Learner access removed. Progress and audit history were retained.",
      );
      setRemoval(null);
      await onChanged();
    } finally {
      setRemovalPending(false);
    }
  }

  const canEnroll =
    detail.course.status === "published" && publishedVersions.length > 0;

  return (
    <section aria-labelledby="course-roster-heading" className={classes.root}>
      <header className={classes.header}>
        <div>
          <h2 id="course-roster-heading" className={classes.heading}>
            Learner roster
          </h2>
          <p className={classes.description}>
            Add access to an exact published version or review retained learner
            history.
          </p>
        </div>
        <span className={classes.count}>
          {detail.roster.total}{" "}
          {detail.roster.total === 1 ? "enrolment" : "enrolments"}
        </span>
      </header>

      {message ? (
        <Alert color="green" role="status">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}

      <form
        className={classes.enrollmentForm}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void enrollmentForm.handleSubmit();
        }}
      >
        <Stack gap="sm">
          <div>
            <h3 className={classes.formHeading}>Add learner access</h3>
            <Text c="dimmed" size="sm">
              The learner must already have a verified Upskill account.
              Re-adding removed or expired access retains their existing
              progress.
            </Text>
          </div>
          <div className={classes.formFields}>
            <enrollmentForm.Field name="learnerEmail">
              {(field) => (
                <MantineTextInput
                  type="email"
                  label="Learner email"
                  placeholder="learner@example.com"
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  disabled={!canEnroll}
                  required
                />
              )}
            </enrollmentForm.Field>
            <enrollmentForm.Field name="courseVersionId">
              {(field) => (
                <MantineNativeSelect
                  label="Published version"
                  data={publishedVersions.map((version) => ({
                    value: version.id,
                    label: `Version ${String(version.version)}`,
                  }))}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  disabled={!canEnroll}
                  required
                />
              )}
            </enrollmentForm.Field>
          </div>
          {!canEnroll ? (
            <Text c="dimmed" size="sm">
              Publish and activate a course version before adding learner
              access.
            </Text>
          ) : null}
          <enrollmentForm.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Group justify="flex-end">
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canEnroll || isSubmitting}
                >
                  Add learner
                </Button>
              </Group>
            )}
          </enrollmentForm.Subscribe>
        </Stack>
      </form>

      {detail.roster.enrollments.length === 0 ? (
        <p className={classes.empty}>This course has no learner enrolments.</p>
      ) : (
        <div className={classes.rosterGrid}>
          {detail.roster.enrollments.map((enrollment) => (
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
                {formatLocalDate(enrollment.enrolledAt)}
                {enrollment.state === "removed" && enrollment.removedAt
                  ? ` · Removed ${formatLocalDate(enrollment.removedAt)}`
                  : enrollment.state === "completed" && enrollment.completedAt
                    ? ` · Completed ${formatLocalDate(enrollment.completedAt)}`
                    : enrollment.expiresAt
                      ? ` · ${enrollment.state === "expired" ? "Expired" : "Expires"} ${formatLocalDate(enrollment.expiresAt)}`
                      : ""}
              </p>
              <div className={classes.cardActions}>
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
                {enrollment.state !== "removed" ? (
                  <Button
                    color="red"
                    variant="subtle"
                    onClick={() => {
                      setRemoval(enrollment);
                    }}
                  >
                    Remove access
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {detail.roster.total > detail.roster.limit ? (
        <p className={classes.description}>
          Showing the {detail.roster.limit} most recent enrolments. Use learner
          search to find older records.
        </p>
      ) : null}

      {removal ? (
        <ConfirmationDialog
          title="Remove learner access?"
          description={`Remove ${removal.learnerName}'s access to version ${String(removal.courseVersion)}? Their progress, completion and audit history will be retained.`}
          confirmLabel="Remove access"
          pending={removalPending}
          onCancel={() => {
            setRemoval(null);
          }}
          onConfirm={() => {
            void confirmRemoval();
          }}
        />
      ) : null}
    </section>
  );
}
