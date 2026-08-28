import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import { AppDialog } from "#/features/shared/AppDialog";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { firstFormError } from "#/features/shared/form-errors";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createAdminEnterpriseContract,
  assignAdminEnterpriseContractOwners,
  bulkEnrollAdminEnterpriseContract,
  renewAdminEnterpriseContract,
  replaceAdminEnterpriseContractEligibility,
  revokeAdminEnterpriseContractOwner,
  rotateAdminEnterpriseContractCode,
  revealAdminEnterpriseContractCode,
  transitionAdminEnterpriseContract,
} from "#/server/functions/admin-enterprise-contract";
import {
  adminEnterpriseContractCreateSchema,
  type AdminEnterpriseContract,
  type AdminEnterpriseContractDirectory,
  type AdminEnterpriseContractResult,
} from "./admin-contract.schema";
import classes from "./AdminEnterpriseContractManager.module.css";

function readable(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

function statusColor(status: AdminEnterpriseContract["status"]): string {
  if (status === "active") return "green";
  if (status === "draft") return "blue";
  if (status === "suspended" || status === "expired") return "orange";
  return "red";
}

const contractDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function contractDate(value: string): string {
  return contractDateFormatter.format(new Date(value));
}

function ContractForm({
  courses,
  events,
  onDone,
}: {
  courses: AdminEnterpriseContractDirectory["courses"];
  events: AdminEnterpriseContractDirectory["events"];
  onDone: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const form = useForm({
    defaultValues: {
      name: "",
      reference: "",
      organizationName: "",
      startsOn: "",
      expiresOn: "",
      enrollmentDurationDays: 365,
      autoEnrollCourses: false,
      accessCode: "",
      domains: "",
      courseIds: [] as Array<string>,
      eventOccurrenceIds: [] as Array<string>,
      ownerEmails: "",
    },
    validators: { onSubmit: adminEnterpriseContractCreateSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const response = await createAdminEnterpriseContract({ data: value });
      if (response.status === "conflict") {
        setError(
          response.reason === "duplicate_reference"
            ? "That contract reference is already in use."
            : "One or more selected courses are no longer available.",
        );
        return;
      }
      if (response.status !== "ready") {
        setError("The enterprise contract could not be created.");
        return;
      }
      setIssuedCode(response.data.accessCode ?? null);
      setCopyState("idle");
      await router.invalidate();
    },
  });

  return (
    <Stack gap="md">
      {error ? <Alert color="red">{error}</Alert> : null}
      {issuedCode ? (
        <Alert color="green" title="Draft contract created">
          <Stack gap="sm">
            <Text size="sm">
              Save the shared code, then activate the contract when its terms
              are ready. Administrators can retrieve the code later.
            </Text>
            <code className={classes.issuedCode}>{issuedCode}</code>
            <div className={classes.issuedActions}>
              <Button
                type="button"
                variant="light"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(issuedCode)
                    .then(() => {
                      setCopyState("copied");
                    })
                    .catch(() => {
                      setCopyState("failed");
                    });
                }}
              >
                {copyState === "copied" ? "Copied" : "Copy code"}
              </Button>
              <Button type="button" variant="default" onClick={onDone}>
                Done
              </Button>
            </div>
            {copyState === "failed" ? (
              <Text size="sm">Select and copy the code manually.</Text>
            ) : null}
          </Stack>
        </Alert>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <Stack gap="md">
            <div className={classes.grid}>
              <form.Field name="name">
                {(field) => (
                  <MantineTextInput
                    label="Contract name"
                    placeholder="2027 workforce learning agreement"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="reference">
                {(field) => (
                  <MantineTextInput
                    label="Contract reference"
                    placeholder="NSW-HEALTH-2027"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="organizationName">
                {(field) => (
                  <MantineTextInput
                    label="Organisation"
                    placeholder="Example Health"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="accessCode">
                {(field) => (
                  <MantineTextInput
                    label="Shared eligibility code"
                    placeholder="EXAMPLE-HEALTH-2027"
                    autoCapitalize="characters"
                    autoComplete="off"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="startsOn">
                {(field) => (
                  <MantineTextInput
                    label="Starts"
                    type="date"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="expiresOn">
                {(field) => (
                  <MantineTextInput
                    label="Ends"
                    type="date"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="enrollmentDurationDays">
                {(field) => (
                  <MantineTextInput
                    label="Learner access duration (days)"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={3650}
                    value={String(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(Number(event.currentTarget.value));
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
            </div>
            <form.Field name="domains">
              {(field) => (
                <MantineTextInput
                  component="textarea"
                  label="Eligible verified-email domains"
                  description="Optional when you will upload an exact employee email list before activation. A shared code is never sufficient by itself."
                  placeholder="example.org, staff.example.com.au"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                />
              )}
            </form.Field>
            <form.Field name="ownerEmails">
              {(field) => (
                <MantineTextInput
                  label="Contract Access Owners (optional)"
                  description="Verified owners can view consent-sharing utilisation and export reports."
                  placeholder="learning.manager@example.org"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                />
              )}
            </form.Field>
            <form.Field name="autoEnrollCourses">
              {(field) => (
                <MantineCheckbox
                  checked={field.state.value}
                  onChange={field.handleChange}
                  label="Automatically enrol a learner in every covered course after they claim and accept information sharing"
                />
              )}
            </form.Field>
            <div>
              <Text fw={600} size="sm" className={classes.sectionLabel}>
                Covered courses
              </Text>
              <form.Subscribe selector={(state) => state.values.courseIds}>
                {(courseIds) => {
                  const selectedCourseIds = new Set(courseIds);
                  return (
                    <div className={classes.courseList}>
                      {courses.map((course) => (
                        <MantineCheckbox
                          key={course.id}
                          checked={selectedCourseIds.has(course.id)}
                          onChange={(checked) => {
                            form.setFieldValue(
                              "courseIds",
                              checked
                                ? [...courseIds, course.id]
                                : courseIds.filter((id) => id !== course.id),
                            );
                          }}
                          label={`${course.title} · current published V${String(course.version)}`}
                        />
                      ))}
                    </div>
                  );
                }}
              </form.Subscribe>
            </div>
            {events.length > 0 ? (
              <div>
                <Text fw={600} size="sm" className={classes.sectionLabel}>
                  Covered scheduled events (optional)
                </Text>
                <form.Subscribe
                  selector={(state) => state.values.eventOccurrenceIds}
                >
                  {(eventOccurrenceIds) => {
                    const selected = new Set(eventOccurrenceIds);
                    return (
                      <div className={classes.courseList}>
                        {events.map((event) => (
                          <MantineCheckbox
                            key={event.id}
                            checked={selected.has(event.id)}
                            onChange={(checked) => {
                              form.setFieldValue(
                                "eventOccurrenceIds",
                                checked
                                  ? [...eventOccurrenceIds, event.id]
                                  : eventOccurrenceIds.filter(
                                      (id) => id !== event.id,
                                    ),
                              );
                            }}
                            label={`${event.title} · ${contractDate(event.startsAt)} · ${String(event.remainingPlaces)} places`}
                          />
                        ))}
                      </div>
                    );
                  }}
                </form.Subscribe>
              </div>
            ) : null}
            <form.Subscribe
              selector={(state) =>
                [state.isSubmitting, state.canSubmit] as const
              }
            >
              {([isSubmitting, canSubmit]) => (
                <Group justify="flex-end">
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={!canSubmit}
                  >
                    Create draft contract
                  </Button>
                </Group>
              )}
            </form.Subscribe>
          </Stack>
        </form>
      )}
    </Stack>
  );
}

function ContractCard({ contract }: { contract: AdminEnterpriseContract }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [operation, setOperation] = useState<
    "rotate" | "renew" | "eligibility" | "owners" | null
  >(null);

  async function transition(
    action: "activate" | "resume" | "suspend" | "terminate",
  ): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await transitionAdminEnterpriseContract({
        data: { enterpriseContractId: contract.id, action },
      });
      if (response.status !== "ready") {
        setError(
          response.status === "conflict" && response.reason === "period_expired"
            ? "This contract period has ended and cannot be activated."
            : response.status === "conflict" &&
                response.reason === "eligibility_required"
              ? "Add a verified-email domain or upload an employee eligibility CSV before activation."
              : "The contract changed before this action completed. Refresh and try again.",
        );
        return;
      }
      setMessage(`${readable(response.data.outcome)} contract.`);
      setTerminateOpen(false);
      await router.invalidate();
    } finally {
      setPending(false);
    }
  }

  async function revealCode(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await revealAdminEnterpriseContractCode({
        data: { enterpriseContractId: contract.id },
      });
      if (response.status !== "ready") {
        setError("The shared code could not be retrieved.");
        return;
      }
      setAccessCode(response.data.accessCode);
    } finally {
      setPending(false);
    }
  }

  async function bulkEnroll(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await bulkEnrollAdminEnterpriseContract({
        data: { enterpriseContractId: contract.id },
      });
      if (response.status !== "ready") {
        setError(
          response.status === "conflict" && response.reason === "bulk_too_large"
            ? "This enrolment run is too large to process safely at once. Reduce the covered courses or contact support for a staged import."
            : "Bulk enrolment could not be completed.",
        );
        return;
      }
      setMessage(
        `${String(response.data.enrolledCount ?? 0)} enrolments created; ${String(response.data.skippedCount ?? 0)} existing enrolments skipped.`,
      );
      await router.invalidate();
    } finally {
      setPending(false);
    }
  }

  async function revokeOwner(ownerAssignmentId: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await revokeAdminEnterpriseContractOwner({
        data: { enterpriseContractId: contract.id, ownerAssignmentId },
      });
      if (response.status !== "ready") {
        setError("The Access Owner could not be removed.");
        return;
      }
      setMessage("Access Owner removed.");
      await router.invalidate();
    } finally {
      setPending(false);
    }
  }

  return (
    <Paper component="article" withBorder radius="lg" p="lg">
      <Stack gap="md">
        <div className={classes.cardHeader}>
          <div>
            <Text c="indigo.7" fw={700} size="sm">
              {contract.organizationName}
            </Text>
            <Title order={3}>{contract.name}</Title>
            <Text c="dimmed" size="sm">
              {contract.reference}
            </Text>
          </div>
          <Badge color={statusColor(contract.status)}>
            {readable(contract.status)}
          </Badge>
        </div>
        {message ? <Alert color="green">{message}</Alert> : null}
        {error ? <Alert color="red">{error}</Alert> : null}
        <div className={classes.facts}>
          <Badge variant="light">
            {contractDate(contract.startsAt)} –{" "}
            {contractDate(contract.expiresAt)}
          </Badge>
          <Badge variant="light">
            {String(contract.claimCount)} eligible learners
          </Badge>
          <Badge variant="light">
            {String(contract.entitlementCount)} enrolments issued
          </Badge>
        </div>
        <div>
          <Text fw={600} size="sm" className={classes.sectionLabel}>
            Covered courses
          </Text>
          <div className={classes.pillList}>
            {contract.coverage.map((coverage) => (
              <Badge key={coverage.id} variant="light">
                {coverage.courseTitle}
              </Badge>
            ))}
          </div>
        </div>
        {contract.eventCoverage.length > 0 ? (
          <div>
            <Text fw={600} size="sm" className={classes.sectionLabel}>
              Covered scheduled events
            </Text>
            <div className={classes.pillList}>
              {contract.eventCoverage.map((coverage) => (
                <Badge key={coverage.id} variant="light">
                  {coverage.eventTitle}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        <Text size="sm" c="dimmed">
          Eligibility: {contract.domains.join(", ")} · learner access lasts{" "}
          {String(contract.enrollmentDurationDays)} days from enrolment ·{" "}
          {String(contract.employeeEligibilityCount)} uploaded employee emails.
        </Text>
        <Text size="sm" c="dimmed">
          Course fulfilment:{" "}
          {contract.autoEnrollCourses
            ? "automatic after learner consent"
            : "learner selects each covered course"}
          .
        </Text>
        {contract.owners.length > 0 ? (
          <div>
            <Text fw={600} size="sm" className={classes.sectionLabel}>
              Contract Access Owners
            </Text>
            <div className={classes.ownerList}>
              {contract.owners.map((owner) => (
                <Group key={owner.id} gap="xs">
                  <Badge variant="light">
                    {owner.email} · {owner.activated ? "active" : "invited"}
                  </Badge>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    disabled={pending}
                    onClick={() => void revokeOwner(owner.id)}
                  >
                    Remove
                  </Button>
                </Group>
              ))}
            </div>
          </div>
        ) : null}
        {accessCode ? (
          <Alert color="gray" title="Shared eligibility code">
            <code className={classes.issuedCode}>{accessCode}</code>
          </Alert>
        ) : null}
        <div className={classes.actions}>
          <Button
            type="button"
            variant="default"
            loading={pending}
            onClick={() => void revealCode()}
          >
            Reveal code
          </Button>
          <Button
            component="a"
            href={`/api/admin/contracts/${encodeURIComponent(contract.id)}/utilisation.csv`}
            variant="default"
          >
            Export utilisation
          </Button>
          {!["terminated", "expired"].includes(contract.status) ? (
            <Button
              type="button"
              variant="default"
              disabled={pending}
              onClick={() => {
                setOperation("rotate");
              }}
            >
              Rotate code
            </Button>
          ) : null}
          <Button
            type="button"
            variant="default"
            disabled={pending}
            onClick={() => {
              setOperation("eligibility");
            }}
          >
            Replace employee list
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={pending}
            onClick={() => {
              setOperation("owners");
            }}
          >
            Add Access Owners
          </Button>
          {contract.status === "active" ? (
            <Button
              type="button"
              variant="light"
              disabled={pending}
              onClick={() => void bulkEnroll()}
            >
              Enrol consented learners
            </Button>
          ) : null}
          {!contract.renewalContractId && contract.status !== "draft" ? (
            <Button
              type="button"
              variant="default"
              disabled={pending}
              onClick={() => {
                setOperation("renew");
              }}
            >
              Create renewal
            </Button>
          ) : null}
          {contract.status === "draft" ? (
            <Button
              loading={pending}
              onClick={() => void transition("activate")}
            >
              Activate
            </Button>
          ) : null}
          {contract.status === "active" ? (
            <Button
              variant="light"
              loading={pending}
              onClick={() => void transition("suspend")}
            >
              Suspend
            </Button>
          ) : null}
          {contract.status === "suspended" ? (
            <Button loading={pending} onClick={() => void transition("resume")}>
              Resume
            </Button>
          ) : null}
          {!["terminated", "expired"].includes(contract.status) ? (
            <Button
              color="red"
              variant="subtle"
              disabled={pending}
              onClick={() => {
                setTerminateOpen(true);
              }}
            >
              Terminate
            </Button>
          ) : null}
        </div>
      </Stack>
      {terminateOpen ? (
        <ConfirmationDialog
          title="Terminate enterprise contract?"
          description="New eligibility claims and enrolments will stop immediately. Existing enrolments and learning evidence will be retained."
          confirmLabel="Terminate contract"
          pending={pending}
          onCancel={() => {
            setTerminateOpen(false);
          }}
          onConfirm={() => void transition("terminate")}
        />
      ) : null}
      {operation ? (
        <ContractOperationDialog
          contract={contract}
          operation={operation}
          onClose={() => {
            setOperation(null);
          }}
          onComplete={async (result) => {
            setOperation(null);
            setAccessCode(result.accessCode ?? null);
            setMessage(result.message);
            await router.invalidate();
          }}
        />
      ) : null}
    </Paper>
  );
}

function ContractOperationDialog({
  contract,
  operation,
  onClose,
  onComplete,
}: {
  contract: AdminEnterpriseContract;
  operation: "rotate" | "renew" | "eligibility" | "owners";
  onClose: () => void;
  onComplete: (result: {
    message: string;
    accessCode?: string;
  }) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [reference, setReference] = useState("");
  const [name, setName] = useState(`${contract.name} renewal`);
  const [startsOn, setStartsOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [ownerEmails, setOwnerEmails] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const title =
    operation === "rotate"
      ? "Rotate shared code"
      : operation === "renew"
        ? "Create contract renewal"
        : operation === "eligibility"
          ? "Replace employee eligibility list"
          : "Add Contract Access Owners";
  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      if (operation === "rotate") {
        const response = await rotateAdminEnterpriseContractCode({
          data: { enterpriseContractId: contract.id, accessCode },
        });
        if (response.status !== "ready") throw new Error();
        if (!response.data.accessCode) throw new Error();
        await onComplete({
          message: "Shared code rotated. The previous code no longer works.",
          accessCode: response.data.accessCode,
        });
      } else if (operation === "renew") {
        const response = await renewAdminEnterpriseContract({
          data: {
            enterpriseContractId: contract.id,
            name,
            reference,
            startsOn,
            expiresOn,
            accessCode,
          },
        });
        if (response.status !== "ready") throw new Error();
        if (!response.data.accessCode) throw new Error();
        await onComplete({
          message:
            "Renewal draft created with cloned coverage, eligibility and owners.",
          accessCode: response.data.accessCode,
        });
      } else if (operation === "eligibility") {
        if (!file) {
          setError("Select a CSV file.");
          return;
        }
        const response = await replaceAdminEnterpriseContractEligibility({
          data: {
            enterpriseContractId: contract.id,
            csvText: await file.text(),
          },
        });
        if (response.status !== "ready") throw new Error();
        await onComplete({
          message: `${String(response.data.importedCount ?? 0)} employee emails imported.`,
        });
      } else {
        const response = await assignAdminEnterpriseContractOwners({
          data: { enterpriseContractId: contract.id, ownerEmails },
        });
        if (response.status !== "ready") throw new Error();
        await onComplete({ message: "Contract Access Owners assigned." });
      }
    } catch {
      setError(
        "The contract operation could not be completed. Check the values and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <AppDialog title={title} onClose={onClose} size="md">
      <Stack gap="md">
        {error ? <Alert color="red">{error}</Alert> : null}
        {operation === "rotate" ? (
          <MantineTextInput
            label="New shared eligibility code"
            value={accessCode}
            onChange={(event) => {
              setAccessCode(event.currentTarget.value);
            }}
            autoComplete="off"
            required
          />
        ) : null}
        {operation === "renew" ? (
          <>
            <MantineTextInput
              label="Renewal name"
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
              required
            />
            <MantineTextInput
              label="New reference"
              value={reference}
              onChange={(event) => {
                setReference(event.currentTarget.value);
              }}
              required
            />
            <div className={classes.grid}>
              <MantineTextInput
                type="date"
                label="Starts"
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.currentTarget.value);
                }}
                required
              />
              <MantineTextInput
                type="date"
                label="Ends"
                value={expiresOn}
                onChange={(event) => {
                  setExpiresOn(event.currentTarget.value);
                }}
                required
              />
            </div>
            <MantineTextInput
              label="New shared eligibility code"
              value={accessCode}
              onChange={(event) => {
                setAccessCode(event.currentTarget.value);
              }}
              autoComplete="off"
              required
            />
          </>
        ) : null}
        {operation === "eligibility" ? (
          <MantineFilePicker
            accept=".csv,text/csv"
            label="Employee eligibility CSV"
            description="Use an email column and optional name column. This replaces the active uploaded list; prior import evidence is retained."
            placeholder="Select CSV"
            value={file}
            onChange={setFile}
            required
          />
        ) : null}
        {operation === "owners" ? (
          <MantineTextInput
            component="textarea"
            label="Owner emails"
            description="Separate multiple verified email addresses with commas or new lines."
            value={ownerEmails}
            onChange={(event) => {
              setOwnerEmails(event.currentTarget.value);
            }}
            required
          />
        ) : null}
        <Group justify="flex-end">
          <Button variant="default" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={() => void submit()}>
            Confirm
          </Button>
        </Group>
      </Stack>
    </AppDialog>
  );
}

export function AdminEnterpriseContractManager({
  result,
}: {
  result: AdminEnterpriseContractResult<AdminEnterpriseContractDirectory>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  if (result.status === "forbidden") return <AdminAccessDenied />;
  if (result.status === "unauthenticated") return null;
  return (
    <Stack gap="lg">
      <div className={classes.header}>
        <div>
          <Text c="indigo.7" fw={700}>
            Organisation access
          </Text>
          <Title order={1}>Enterprise contracts</Title>
          <Text c="dimmed" maw={760}>
            Govern blanket course access by contract period, verified identity
            domain and immutable coverage. Enrolments are created only when an
            eligible learner selects a covered course.
          </Text>
        </div>
        <Button
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          Create contract
        </Button>
      </div>
      {result.data.contracts.length === 0 ? (
        <Alert title="No enterprise contracts">
          Create the first blanket learning agreement as a draft, review its
          coverage, then activate it.
        </Alert>
      ) : (
        <div className={classes.contractGrid}>
          {result.data.contracts.map((contract) => (
            <ContractCard contract={contract} key={contract.id} />
          ))}
        </div>
      )}
      {createOpen ? (
        <AppDialog
          title="Create enterprise contract"
          size="lg"
          onClose={() => {
            setCreateOpen(false);
          }}
        >
          <ContractForm
            courses={result.data.courses}
            events={result.data.events}
            onDone={() => {
              setCreateOpen(false);
            }}
          />
        </AppDialog>
      ) : null}
    </Stack>
  );
}
