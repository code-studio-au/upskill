import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AdminDirectoryHeader,
  AdminDirectoryFilters,
  AdminDirectoryResults,
  AdminDirectorySearch,
} from "#/features/admin/AdminDirectory";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { RemovableFilterChip } from "#/features/shared/RemovableFilterChip";
import { firstFormError } from "#/features/shared/form-errors";
import { formatLocalDate } from "#/features/shared/local-date";
import { Alert, Button, Group, Stack } from "#/features/shared/mantine";
import {
  addAdminCourseEnrollment,
  getAdminCourseRoster,
  removeAdminCourseEnrollment,
} from "#/server/functions/admin-course";
import { AdminRegistrationQuestionnaireDialog } from "#/features/registration/AdminRegistrationQuestionnaireDialog";
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
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RosterEnrollment | null>(null);
  const [removalPending, setRemovalPending] = useState(false);
  const [registrationDetail, setRegistrationDetail] =
    useState<RosterEnrollment | null>(null);
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
        rosterColumn.accessor("registrationQuestionnaireStatus", {
          header: "Registration details",
          cell: ({ row }) => (
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={
                row.original.registrationQuestionnaireStatus === "not_required"
              }
              onClick={() => {
                setRegistrationDetail(row.original);
              }}
            >
              {row.original.registrationQuestionnaireStatus.replaceAll(
                "_",
                " ",
              )}
            </Button>
          ),
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
  const pagination = directory?.pagination ?? {
    page: 1,
    pages: 1,
    total: 0,
    pageSize: 20,
  };

  return (
    <section aria-labelledby="course-roster-heading" className={classes.root}>
      <AdminDirectoryHeader
        headingId="course-roster-heading"
        title="Learner roster"
        order={2}
        count={`${String(directory?.pagination.total ?? detail.course.enrollmentCount)} enrolments`}
      />

      {message ? <Alert color="green">{message}</Alert> : null}
      {error ? <Alert color="red">{error}</Alert> : null}

      {registrationDetail ? (
        <AdminRegistrationQuestionnaireDialog
          learnerName={registrationDetail.learnerName}
          target={{
            kind: "course",
            courseId: detail.course.id,
            enrollmentId: registrationDetail.enrollmentId,
          }}
          onClose={() => {
            setRegistrationDetail(null);
          }}
          onChanged={() => {
            setRevision((current) => current + 1);
            setMessage("Registration requirement waived.");
          }}
        />
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

      <AdminDirectorySearch
        key={query}
        query={query}
        label="Search enrolments"
        placeholder="Name or email address"
        navigating={loading}
        submitLabel="Search"
        onSubmit={(form) => {
          const value = form.get("q");
          setLoading(true);
          setQuery(typeof value === "string" ? value.trim() : "");
          setPage(1);
          setRevision((current) => current + 1);
        }}
      />

      {query ? (
        <AdminDirectoryFilters>
          <RemovableFilterChip
            label="Search"
            value={query}
            onRemove={() => {
              setLoading(true);
              setQuery("");
              setPage(1);
              setRevision((current) => current + 1);
            }}
          />
        </AdminDirectoryFilters>
      ) : null}

      <AdminDirectoryResults
        pagination={pagination}
        table={table}
        caption="Course learner enrolments and access status"
        numericColumns={numericColumns}
        emptyText="No enrolments found."
        loading={loading}
        onPageChange={(nextPage) => {
          setLoading(true);
          setPage(nextPage);
        }}
      />

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
