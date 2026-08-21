import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { firstFormError } from "#/features/shared/form-errors";
import { formatLocalDate } from "#/features/shared/local-date";
import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import {
  addAdminCourseEnrollment,
  getAdminCourseRoster,
  removeAdminCourseEnrollment,
} from "#/server/functions/admin-course";
import {
  adminCourseEnrollmentCreateSchema,
  type AdminCourseDetail,
  type AdminCourseRosterDirectory,
} from "./admin-course.schema";
import classes from "./AdminCourseRoster.module.css";

interface AdminCourseRosterProps {
  detail: AdminCourseDetail;
  onChanged: () => Promise<void>;
}

type RosterEnrollment = AdminCourseRosterDirectory["enrollments"][number];
const rosterTableFeatures = tableFeatures({});
const rosterColumn = createColumnHelper<
  typeof rosterTableFeatures,
  RosterEnrollment
>();
const numericColumns = new Set(["courseVersion"]);

export function AdminCourseRoster({
  detail,
  onChanged,
}: AdminCourseRosterProps) {
  const [directory, setDirectory] = useState<AdminCourseRosterDirectory | null>(
    null,
  );
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RosterEnrollment | null>(null);
  const [removalPending, setRemovalPending] = useState(false);
  const publishedVersions = useMemo(
    () => detail.versions.filter((version) => version.publishedAt !== null),
    [detail.versions],
  );

  useEffect(() => {
    let active = true;
    void getAdminCourseRoster({
      data: { courseId: detail.course.id, q: query, page },
    })
      .then((result) => {
        if (!active) return;
        if (result.status === "ready") {
          setDirectory(result.data);
          if (result.data.pagination.page !== page) {
            setLoading(true);
            setPage(result.data.pagination.page);
          }
        } else setError("The learner roster could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detail.course.id, page, query, revision]);

  const enrollmentForm = useForm({
    defaultValues: {
      courseId: detail.course.id,
      courseVersionId: publishedVersions[0]?.id ?? "",
      learnerEmail: "",
    },
    validators: { onSubmit: adminCourseEnrollmentCreateSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setMessage(null);
      const result = await addAdminCourseEnrollment({ data: value });
      if (result.status === "not-found") {
        setError(
          result.entity === "learner"
            ? "No learner account matches that email address."
            : "Choose an available published course version.",
        );
        return;
      }
      if (result.status === "conflict") {
        setError("That learner already has access to this course version.");
        return;
      }
      if (result.status !== "ready") {
        setError("The learner could not be enrolled.");
        return;
      }
      enrollmentForm.setFieldValue("learnerEmail", "");
      setMessage(
        result.data.outcome === "restored"
          ? "Learner access restored."
          : "Learner enrolled.",
      );
      setLoading(true);
      setQuery("");
      setQueryInput("");
      setPage(1);
      setRevision((current) => current + 1);
      await onChanged();
    },
  });

  async function confirmRemoval() {
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
        setError("Learner access could not be removed.");
        return;
      }
      setMessage("Learner access removed. Progress history was retained.");
      setRemoval(null);
      setLoading(true);
      setRevision((current) => current + 1);
      await onChanged();
    } finally {
      setRemovalPending(false);
    }
  }

  const columns = useMemo(
    () =>
      rosterColumn.columns([
        rosterColumn.accessor("learnerName", {
          header: "Learner",
          cell: ({ row }) => (
            <Link
              to="/admin/learners/$userId/enrollments/$enrollmentId"
              params={{
                userId: row.original.learnerId,
                enrollmentId: row.original.enrollmentId,
              }}
              className={classes.learnerLink}
            >
              {row.original.learnerName}
            </Link>
          ),
        }),
        rosterColumn.accessor("learnerEmail", { header: "Email" }),
        rosterColumn.accessor("courseVersion", { header: "Version" }),
        rosterColumn.accessor("state", {
          header: "Status",
          cell: ({ row }) => (
            <Badge
              color={
                row.original.state === "completed"
                  ? "green"
                  : row.original.state === "expired"
                    ? "orange"
                    : row.original.state === "removed"
                      ? "gray"
                      : "blue"
              }
              variant="light"
            >
              {row.original.state}
            </Badge>
          ),
        }),
        rosterColumn.accessor("enrolledAt", {
          header: "Enrolled",
          cell: ({ row }) => formatLocalDate(row.original.enrolledAt),
        }),
        rosterColumn.display({
          id: "actions",
          header: "Actions",
          cell: ({ row }) =>
            row.original.state === "removed" ? null : (
              <Button
                size="compact-xs"
                color="red"
                variant="subtle"
                onClick={() => {
                  setRemoval(row.original);
                }}
              >
                Remove access
              </Button>
            ),
        }),
      ]),
    [],
  );
  const table = useTable({
    features: rosterTableFeatures,
    columns,
    data: directory?.enrollments ?? [],
  });
  const canEnroll =
    detail.course.status === "published" && publishedVersions.length > 0;
  const firstResult =
    !directory || directory.pagination.total === 0
      ? 0
      : directory.pagination.pageSize * (directory.pagination.page - 1) + 1;
  const lastResult = directory?.enrollments.length
    ? firstResult + directory.enrollments.length - 1
    : 0;

  return (
    <section aria-labelledby="course-roster-heading" className={classes.root}>
      <header className={classes.header}>
        <h2 id="course-roster-heading" className={classes.heading}>
          Learner roster
        </h2>
        <span className={classes.count}>
          {directory?.pagination.total ?? detail.course.enrollmentCount}{" "}
          enrolments
        </span>
      </header>

      {message ? <Alert color="green">{message}</Alert> : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      <form
        className={classes.enrollmentForm}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void enrollmentForm.handleSubmit();
        }}
      >
        <Stack gap="sm">
          <h3 className={classes.formHeading}>Add learner access</h3>
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

      <form
        className={classes.searchForm}
        onSubmit={(event) => {
          event.preventDefault();
          setLoading(true);
          setQuery(queryInput.trim());
          setPage(1);
          setRevision((current) => current + 1);
        }}
      >
        <MantineTextInput
          label="Search enrolments"
          value={queryInput}
          placeholder="Name or email address"
          maxLength={100}
          onChange={(event) => {
            setQueryInput(event.currentTarget.value);
          }}
        />
        <Button type="submit" loading={loading}>
          Search
        </Button>
      </form>

      {query ? (
        <RemovableFilterChip
          label="Search"
          value={query}
          onRemove={() => {
            setLoading(true);
            setQuery("");
            setQueryInput("");
            setPage(1);
            setRevision((current) => current + 1);
          }}
        />
      ) : null}

      <Text c="dimmed" size="sm">
        Showing {firstResult}–{lastResult} of {directory?.pagination.total ?? 0}{" "}
        enrolments
      </Text>

      {directory?.enrollments.length ? (
        <ResponsiveDataTable
          table={table}
          caption="Course learner enrolments and access status"
          numericColumns={numericColumns}
        />
      ) : loading ? (
        <Text c="dimmed">Loading enrolments…</Text>
      ) : (
        <p className={classes.empty}>No enrolments found.</p>
      )}

      {directory && directory.pagination.pages > 1 ? (
        <Group justify="space-between" className={classes.pagination}>
          <Button
            variant="light"
            disabled={directory.pagination.page === 1 || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(1, current - 1));
            }}
          >
            Previous
          </Button>
          <Text size="sm">
            Page {directory.pagination.page} of {directory.pagination.pages}
          </Text>
          <Button
            variant="light"
            disabled={
              directory.pagination.page === directory.pagination.pages ||
              loading
            }
            onClick={() => {
              setLoading(true);
              setPage((current) => current + 1);
            }}
          >
            Next
          </Button>
        </Group>
      ) : null}

      {removal ? (
        <ConfirmationDialog
          title="Remove learner access?"
          description={`Remove ${removal.learnerName}'s access to version ${String(removal.courseVersion)}? Their progress and audit history will be retained.`}
          confirmLabel="Remove access"
          pending={removalPending}
          onCancel={() => {
            setRemoval(null);
          }}
          onConfirm={() => void confirmRemoval()}
        />
      ) : null}
    </section>
  );
}
