import { lazy, Suspense, useMemo, useState } from "react";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { formatLocalDate } from "#/features/shared/local-date";
import { ResponsiveDataTable } from "#/features/shared/ResponsiveDataTable";
import { revealAccessOwnerGrantCode } from "#/server/functions/access-owner";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import type { AccessOwnerDashboard as DashboardData } from "./access-owner.schema";
import classes from "./AccessOwnerDashboard.module.css";

type LearnerRow = DashboardData["grants"][number]["learners"][number];
const learnerTableFeatures = tableFeatures({});
const learnerColumn = createColumnHelper<
  typeof learnerTableFeatures,
  LearnerRow
>();
const numericColumns = new Set(["progressPercent"]);
const AccessOwnerCommercePanel = lazy(async () => {
  const module = await import("./AccessOwnerCommercePanel");
  return { default: module.AccessOwnerCommercePanel };
});

function AccessOwnerLearnerTable({
  learners,
}: {
  learners: Array<LearnerRow>;
}) {
  const columns = useMemo(
    () =>
      learnerColumn.columns([
        learnerColumn.accessor("codeNumber", {
          header: "Code",
          cell: ({ row }) =>
            row.original.codeNumber === null
              ? "Shared"
              : `#${String(row.original.codeNumber)}`,
        }),
        learnerColumn.accessor("name", { header: "Learner" }),
        learnerColumn.accessor("email", { header: "Redemption email" }),
        learnerColumn.accessor("enrolledAt", {
          header: "Enrolled",
          cell: ({ row }) => formatLocalDate(row.original.enrolledAt),
        }),
        learnerColumn.accessor("progressPercent", {
          header: "Progress",
          cell: ({ row }) => `${String(row.original.progressPercent)}%`,
        }),
        learnerColumn.accessor("completionState", {
          header: "Status",
          cell: ({ row }) => (
            <Badge
              color={
                row.original.completionState === "complete" ? "green" : "gray"
              }
            >
              {row.original.completionState}
            </Badge>
          ),
        }),
      ]),
    [],
  );
  const table = useTable({
    features: learnerTableFeatures,
    columns,
    data: learners,
  });
  return (
    <ResponsiveDataTable
      table={table}
      caption="Access-granted learner progress"
      numericColumns={numericColumns}
    />
  );
}

export function AccessOwnerDashboard({
  dashboard,
}: {
  dashboard: DashboardData;
}) {
  return (
    <Container size="xl" className={classes.page}>
      <Stack gap="xl">
        <div className={classes.header}>
          <Title order={1}>Access management</Title>
        </div>
        {dashboard.contracts.map((contract) => (
          <Paper
            component="article"
            withBorder
            radius="lg"
            p="lg"
            key={contract.id}
          >
            <Stack gap="md">
              <div className={classes.grantHeader}>
                <div>
                  <Text c="indigo.7" fw={700}>
                    {contract.organizationName}
                  </Text>
                  <Title order={2} size="h3">
                    {contract.name}
                  </Title>
                  <Text size="sm" c="dimmed">
                    {contract.reference}
                  </Text>
                </div>
                <Badge color={contract.status === "active" ? "green" : "gray"}>
                  {contract.status}
                </Badge>
              </div>
              <dl className={classes.metrics}>
                <div>
                  <dt>Uploaded eligibility</dt>
                  <dd>{contract.eligibleEmployeeCount}</dd>
                </div>
                <div>
                  <dt>Claimed</dt>
                  <dd>{contract.learners.length}</dd>
                </div>
                <div>
                  <dt>Ends</dt>
                  <dd>{formatLocalDate(contract.expiresAt)}</dd>
                </div>
              </dl>
              <Group justify="flex-end">
                <Button
                  component="a"
                  href={`/api/access-management/contracts/${encodeURIComponent(contract.id)}/utilisation.csv`}
                  variant="default"
                  size="xs"
                >
                  Export utilisation CSV
                </Button>
              </Group>
              <Title order={3} size="h4">
                Consent-sharing learners
              </Title>
              {contract.learners.length === 0 ? (
                <Text c="dimmed" size="sm">
                  No learners have claimed this contract and accepted
                  information sharing.
                </Text>
              ) : (
                <div className={classes.contractLearners}>
                  {contract.learners.map((learner) => (
                    <Paper
                      withBorder
                      radius="md"
                      p="sm"
                      key={`${learner.email}-${learner.claimedAt}`}
                    >
                      <Text fw={600}>{learner.name}</Text>
                      <Text size="sm">{learner.email}</Text>
                      <Text size="sm" c="dimmed">
                        {learner.courseEnrollmentCount} courses ·{" "}
                        {learner.eventRegistrationCount} events · claimed{" "}
                        {formatLocalDate(learner.claimedAt)}
                      </Text>
                    </Paper>
                  ))}
                </div>
              )}
            </Stack>
          </Paper>
        ))}
        <div className={classes.grid}>
          {dashboard.grants.map((grant) => (
            <AccessGrantPanel grant={grant} key={grant.id} />
          ))}
        </div>
      </Stack>
    </Container>
  );
}

function AccessGrantPanel({
  grant,
}: {
  grant: DashboardData["grants"][number];
}) {
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reveal(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await revealAccessOwnerGrantCode({
        data: { accessGrantId: grant.id },
      });
      if (result.status !== "ready") {
        setError("The access code could not be retrieved.");
        return;
      }
      setAccessCode(result.data.accessCode);
    } finally {
      setPending(false);
    }
  }
  return (
    <Paper component="article" withBorder radius="lg" p="lg">
      <Stack gap="md">
        <div className={classes.grantHeader}>
          <div>
            <Text c="indigo.7" fw={700}>
              {grant.organizationName}
            </Text>
            <Title order={2} size="h3">
              {grant.label}
            </Title>
            <Text size="sm" c="dimmed">
              {grant.offeringTitle}
            </Text>
          </div>
          <Badge color={grant.state === "active" ? "green" : "gray"}>
            {grant.state}
          </Badge>
        </div>
        <dl className={classes.metrics}>
          <div>
            <dt>Purchased</dt>
            <dd>{grant.quantity}</dd>
          </div>
          <div>
            <dt>Used</dt>
            <dd>{grant.redeemed}</dd>
          </div>
          <div>
            <dt>Remaining</dt>
            <dd>{grant.remaining}</dd>
          </div>
        </dl>
        <div className={classes.actions}>
          <Group gap="sm">
            {grant.fulfillmentMode === "single_use_codes" ? (
              <Button
                component="a"
                href={`/api/access-management/${encodeURIComponent(grant.id)}/codes.csv`}
                variant="light"
                size="xs"
              >
                Download code CSV
              </Button>
            ) : accessCode ? (
              <>
                <code className={classes.code}>{accessCode}</code>
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => {
                    setAccessCode(null);
                  }}
                >
                  Hide
                </Button>
              </>
            ) : (
              <Button
                variant="light"
                size="xs"
                loading={pending}
                onClick={() => void reveal()}
              >
                Show access code
              </Button>
            )}
          </Group>
          <Group gap="sm">
            {grant.expiresAt ? (
              <Text size="sm">Expires {formatLocalDate(grant.expiresAt)}</Text>
            ) : null}
            <Button
              component="a"
              href={`/api/access-management/${encodeURIComponent(grant.id)}/learners.csv`}
              variant="default"
              size="xs"
            >
              Export learner CSV
            </Button>
          </Group>
        </div>
        {error ? <Alert color="red">{error}</Alert> : null}
        <Suspense fallback={<LoadingSpinner />}>
          <AccessOwnerCommercePanel grant={grant} />
        </Suspense>
        <Title order={3} size="h4">
          Access-granted learners
        </Title>
        {grant.learners.length === 0 ? (
          <Text c="dimmed" size="sm">
            No learners have accepted access-owner information sharing for this
            grant.
          </Text>
        ) : (
          <AccessOwnerLearnerTable learners={grant.learners} />
        )}
      </Stack>
    </Paper>
  );
}
