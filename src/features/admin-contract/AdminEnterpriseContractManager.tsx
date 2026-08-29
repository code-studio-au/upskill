import { Link, useRouter } from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import { AppDialog } from "#/features/shared/AppDialog";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import { formatLocalDate } from "#/features/shared/local-date";
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
        `${String(response.data.enrolledCount ?? 0)} course enrolments and ${String(response.data.eventRegisteredCount ?? 0)} event registrations created; ${String((response.data.skippedCount ?? 0) + (response.data.eventSkippedCount ?? 0))} unavailable or existing items skipped.`,
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

  const facts = [
    [
      "Contract period",
      `${formatLocalDate(contract.startsAt.slice(0, 10))} – ${formatLocalDate(contract.expiresAt.slice(0, 10))}`,
    ],
    ["Learner access", `${String(contract.enrollmentDurationDays)} days`],
    ["Eligible employees", String(contract.employeeEligibilityCount)],
    ["Learners claimed", String(contract.claimCount)],
    ["Enrolments issued", String(contract.entitlementCount)],
  ];
  const coverage = [
    {
      label: "Courses",
      empty: "No courses covered.",
      items: contract.coverage.map((item) => ({
        id: item.id,
        title: item.courseTitle,
      })),
    },
    {
      label: "Scheduled events",
      empty: "No scheduled events covered.",
      items: contract.eventCoverage.map((item) => ({
        id: item.id,
        title: item.eventTitle,
      })),
    },
  ];

  return (
    <article className={classes.contractCard}>
      <div className={classes.contractCardBody}>
        <div className={classes.cardHeader}>
          <div className={classes.contractIdentity}>
            <p className={classes.eyebrow}>{contract.organizationName}</p>
            <h2>{contract.name}</h2>
            <p className={classes.muted}>Reference {contract.reference}</p>
          </div>
          <div className={classes.statusActions}>
            <Badge color={statusColor(contract.status)} variant="light">
              {readable(contract.status)}
            </Badge>
            {contract.status === "draft" ? (
              <Button
                type="button"
                loading={pending}
                onClick={() => void transition("activate")}
              >
                Activate
              </Button>
            ) : null}
            {contract.status === "active" ? (
              <Button
                type="button"
                variant="light"
                loading={pending}
                onClick={() => void transition("suspend")}
              >
                Suspend
              </Button>
            ) : null}
            {contract.status === "suspended" ? (
              <Button
                type="button"
                loading={pending}
                onClick={() => void transition("resume")}
              >
                Resume
              </Button>
            ) : null}
          </div>
        </div>

        {message ? <Alert color="green">{message}</Alert> : null}
        {error ? <Alert color="red">{error}</Alert> : null}

        <div className={classes.contractFacts}>
          {facts.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className={classes.contractColumns}>
          <section className={classes.contractSection}>
            <header>
              <h3>Eligibility and Access Owners</h3>
              <p>Identity rules controlling who can claim the contract.</p>
            </header>
            <div>
              <strong className={classes.sectionLabel}>
                Verified-email domains
              </strong>
              {contract.domains.length ? (
                <div className={classes.pillList}>
                  {contract.domains.map((domain) => (
                    <Badge
                      key={domain}
                      variant="light"
                      className={classes.coveragePill}
                    >
                      {domain}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className={classes.muted}>Uploaded employee list only</p>
              )}
            </div>
            <div>
              <strong className={classes.sectionLabel}>
                Contract Access Owners
              </strong>
              {contract.owners.length ? (
                <div className={classes.ownerList}>
                  {contract.owners.map((owner) => (
                    <div className={classes.ownerRow} key={owner.id}>
                      <div className={classes.ownerIdentity}>
                        <strong>{owner.email}</strong>
                        <small className={classes.muted}>
                          {owner.activated ? "Active" : "Invitation pending"}
                        </small>
                      </div>
                      <Button
                        type="button"
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        disabled={pending}
                        onClick={() => void revokeOwner(owner.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={classes.muted}>No Access Owners assigned.</p>
              )}
            </div>
          </section>

          <section className={classes.contractSection}>
            <header>
              <h3>Learning coverage</h3>
              <p>Offerings learners can access under this contract.</p>
            </header>
            {coverage.map((group) => (
              <div key={group.label}>
                <strong className={classes.sectionLabel}>{group.label}</strong>
                {group.items.length ? (
                  <div className={classes.pillList}>
                    {group.items.map((item) => (
                      <Badge
                        key={item.id}
                        variant="light"
                        className={classes.coveragePill}
                      >
                        {item.title}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className={classes.muted}>{group.empty}</p>
                )}
              </div>
            ))}
            <p>
              <strong>Automatic fulfilment:</strong>{" "}
              {contract.autoEnrollCourses
                ? "Courses and scheduled events after learner consent"
                : "Learner selects each covered offering"}
            </p>
          </section>
        </div>

        {accessCode ? (
          <Alert color="gray" title="Shared eligibility code">
            <code className={classes.issuedCode}>{accessCode}</code>
          </Alert>
        ) : null}

        <details className={classes.managementDisclosure}>
          <summary>Manage contract</summary>
          <div className={classes.managementBody}>
            <p className={classes.muted}>
              Access codes, eligibility imports, owners, reporting and lifecycle
              operations.
            </p>
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
                  Fulfil consented learners
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
              {!["terminated", "expired"].includes(contract.status) ? (
                <Button
                  type="button"
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
          </div>
        </details>
      </div>
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
    </article>
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
  const [file, setFile] = useState<File | null>(null);
  const title =
    operation === "rotate"
      ? "Rotate shared code"
      : operation === "renew"
        ? "Create contract renewal"
        : operation === "eligibility"
          ? "Replace employee eligibility list"
          : "Add Contract Access Owners";
  async function submit(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === "string" ? entry : "";
    };
    setPending(true);
    setError(null);
    try {
      if (operation === "rotate") {
        const response = await rotateAdminEnterpriseContractCode({
          data: {
            enterpriseContractId: contract.id,
            accessCode: value("accessCode"),
          },
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
            name: value("name"),
            reference: value("reference"),
            startsOn: value("startsOn"),
            expiresOn: value("expiresOn"),
            accessCode: value("accessCode"),
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
          data: {
            enterpriseContractId: contract.id,
            ownerEmails: value("ownerEmails"),
          },
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
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap="md">
          {error ? <Alert color="red">{error}</Alert> : null}
          {operation === "rotate" ? (
            <MantineTextInput
              name="accessCode"
              label="New shared eligibility code"
              autoComplete="off"
              required
            />
          ) : null}
          {operation === "renew" ? (
            <>
              <MantineTextInput
                name="name"
                label="Renewal name"
                defaultValue={`${contract.name} renewal`}
                required
              />
              <MantineTextInput
                name="reference"
                label="New reference"
                required
              />
              <div className={classes.grid}>
                <MantineTextInput
                  name="startsOn"
                  type="date"
                  label="Starts"
                  required
                />
                <MantineTextInput
                  name="expiresOn"
                  type="date"
                  label="Ends"
                  required
                />
              </div>
              <MantineTextInput
                name="accessCode"
                label="New shared eligibility code"
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
              name="ownerEmails"
              component="textarea"
              label="Owner emails"
              description="Separate multiple verified email addresses with commas or new lines."
              required
            />
          ) : null}
          <Group justify="flex-end">
            <Button
              type="button"
              variant="default"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Confirm
            </Button>
          </Group>
        </Stack>
      </form>
    </AppDialog>
  );
}

export function AdminEnterpriseContractManager({
  result,
}: {
  result: AdminEnterpriseContractResult<AdminEnterpriseContractDirectory>;
}) {
  if (result.status === "forbidden") return <AdminAccessDenied />;
  if (result.status === "unauthenticated") return null;
  const contracts = result.data.contracts;
  const activeCount = contracts.filter(
    (contract) => contract.status === "active",
  ).length;
  const draftCount = contracts.filter(
    (contract) => contract.status === "draft",
  ).length;
  const offeringCount = contracts.reduce(
    (count, contract) =>
      count + contract.coverage.length + contract.eventCoverage.length,
    0,
  );
  const employeeCount = contracts.reduce(
    (count, contract) => count + contract.employeeEligibilityCount,
    0,
  );
  const summary = [
    ["Total contracts", contracts.length],
    ["Active", activeCount],
    ["Drafts", draftCount],
    ["Covered offerings", offeringCount],
    ["Eligible employees", employeeCount],
  ];
  return (
    <Stack gap="xl">
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
        <Link to="/admin/contracts/new" className={classes.buttonLink}>
          <Button component="span">Create contract</Button>
        </Link>
      </div>
      {contracts.length === 0 ? (
        <Alert title="No enterprise contracts">
          Create the first blanket learning agreement as a draft, review its
          coverage, then activate it.
        </Alert>
      ) : (
        <>
          <section aria-label="Enterprise contract summary">
            <div className={classes.directorySummary}>
              {summary.map(([label, value]) => (
                <Paper withBorder radius="lg" p="md" key={label}>
                  <Text c="dimmed" size="xs" fw={700}>
                    {label}
                  </Text>
                  <Text size="xl" fw={700}>
                    {String(value)}
                  </Text>
                </Paper>
              ))}
            </div>
          </section>
          <section aria-labelledby="contract-directory-heading">
            <Stack gap="md">
              <div>
                <Title order={2} id="contract-directory-heading">
                  Contract directory
                </Title>
                <Text c="dimmed" size="sm">
                  Review coverage and eligibility, then open management actions
                  only when they are needed.
                </Text>
              </div>
              <div className={classes.contractGrid}>
                {contracts.map((contract) => (
                  <ContractCard contract={contract} key={contract.id} />
                ))}
              </div>
            </Stack>
          </section>
        </>
      )}
    </Stack>
  );
}
