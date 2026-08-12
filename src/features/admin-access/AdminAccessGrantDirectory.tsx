import {
  Alert,
  Button,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { formatLocalDate } from "#/features/shared/local-date";
import {
  revealAdminAccessGrantCode,
  revokeAdminAccessGrant,
} from "#/server/functions/admin-access-grant";
import type { AdminAccessGrant } from "./admin-access.schema";
import { AdminAccessGrantCapacityDialog } from "./AdminAccessGrantCapacityDialog";
import classes from "./AdminAccessGrantManager.module.css";

function grantState(
  grant: AdminAccessGrant,
): "active" | "exhausted" | "expired" | "revoked" {
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt && new Date(grant.expiresAt) <= new Date())
    return "expired";
  return grant.redeemed >= grant.quantity ? "exhausted" : "active";
}

export function AdminAccessGrantDirectory({
  grants,
}: {
  grants: Array<AdminAccessGrant>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revocation, setRevocation] = useState<AdminAccessGrant | null>(null);
  const [revocationPending, setRevocationPending] = useState(false);
  const [capacityGrant, setCapacityGrant] = useState<AdminAccessGrant | null>(
    null,
  );

  async function confirmRevocation(): Promise<void> {
    if (!revocation) return;
    setRevocationPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await revokeAdminAccessGrant({
        data: { accessGrantId: revocation.id },
      });
      if (response.status !== "ready") {
        setError(
          "The access grant could not be revoked. Refresh and try again.",
        );
        return;
      }
      setMessage(
        response.data.outcome === "unchanged"
          ? "The access grant was already revoked."
          : "Access grant revoked. Existing learner enrolments were retained.",
      );
      setRevocation(null);
      await router.invalidate();
    } finally {
      setRevocationPending(false);
    }
  }

  return (
    <section aria-labelledby="issued-grants-heading">
      <Stack gap="md">
        <Title order={2} id="issued-grants-heading">
          Issued grants
        </Title>
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
        {grants.length === 0 ? (
          <Alert title="No access grants">
            Create the first organisation access code.
          </Alert>
        ) : (
          <div className={classes.grantGrid}>
            {grants.map((grant) => (
              <GrantCard
                grant={grant}
                onManageCapacity={setCapacityGrant}
                onRevoke={setRevocation}
                key={grant.id}
              />
            ))}
          </div>
        )}
      </Stack>

      {revocation ? (
        <ConfirmationDialog
          title="Revoke access code?"
          description={`No further learners will be able to redeem ${revocation.label}. Existing enrolments and progress will be retained.`}
          confirmLabel="Revoke code"
          pending={revocationPending}
          onCancel={() => {
            if (!revocationPending) setRevocation(null);
          }}
          onConfirm={() => {
            void confirmRevocation();
          }}
        />
      ) : null}
      {capacityGrant ? (
        <AdminAccessGrantCapacityDialog
          grant={capacityGrant}
          onClose={() => {
            setCapacityGrant(null);
          }}
          onUpdated={async (outcome) => {
            setCapacityGrant(null);
            setMessage(
              outcome === "unchanged"
                ? "Access capacity was already set to that value."
                : "Access capacity updated. The existing code is unchanged.",
            );
            await router.invalidate();
          }}
        />
      ) : null}
    </section>
  );
}

function GrantCard({
  grant,
  onManageCapacity,
  onRevoke,
}: {
  grant: AdminAccessGrant;
  onManageCapacity: (grant: AdminAccessGrant) => void;
  onRevoke: (grant: AdminAccessGrant) => void;
}) {
  const state = grantState(grant);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [revealPending, setRevealPending] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function revealCode(): Promise<void> {
    setRevealPending(true);
    setRevealError(null);
    try {
      const response = await revealAdminAccessGrantCode({
        data: { accessGrantId: grant.id },
      });
      if (response.status !== "ready") {
        setRevealError("The access code could not be retrieved.");
        return;
      }
      setAccessCode(response.data.accessCode);
      setCopyState("idle");
    } finally {
      setRevealPending(false);
    }
  }

  async function copyCode(): Promise<void> {
    if (!accessCode) return;
    try {
      await navigator.clipboard.writeText(accessCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }
  return (
    <Paper component="article" withBorder radius="lg" p="md">
      <Stack gap="md">
        <div className={classes.cardHeader}>
          <div className={classes.identity}>
            <Title order={3} size="h4">
              {grant.label}
            </Title>
            <Text c="dimmed" size="sm">
              {grant.organizationName ?? "No organisation"}
            </Text>
          </div>
          <Badge color={state === "active" ? "indigo" : "gray"}>{state}</Badge>
        </div>
        <Text size="sm">
          {grant.courseTitle} · Version {grant.courseVersion}
        </Text>
        <dl className={classes.metrics}>
          <div>
            <dt>Used</dt>
            <dd>
              {grant.redeemed} of {grant.quantity}
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>{grant.enrollmentDurationDays} days</dd>
          </div>
          <div>
            <dt>Code expiry</dt>
            <dd>
              {grant.expiresAt ? formatLocalDate(grant.expiresAt) : "None"}
            </dd>
          </div>
        </dl>
        <Text size="sm" c="dimmed">
          {grant.domains.length > 0
            ? `Restricted to ${grant.domains.join(", ")}`
            : "Available to any verified learner with the code"}
        </Text>
        {accessCode ? (
          <div className={classes.revealedCode} role="status">
            <code className={classes.issuedCode}>{accessCode}</code>
            <div className={classes.codeActions}>
              <Button
                type="button"
                variant="light"
                size="xs"
                onClick={() => {
                  void copyCode();
                }}
              >
                {copyState === "copied" ? "Copied" : "Copy code"}
              </Button>
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={() => {
                  setAccessCode(null);
                }}
              >
                Hide code
              </Button>
            </div>
            {copyState === "failed" ? (
              <Text size="xs">Select the code and copy it manually.</Text>
            ) : null}
          </div>
        ) : null}
        {revealError ? (
          <Alert color="red" role="alert">
            {revealError}
          </Alert>
        ) : null}
        <Redemptions grant={grant} />
        <div className={classes.cardFooter}>
          <Text size="xs" c="dimmed">
            Created {formatLocalDate(grant.createdAt)}
          </Text>
          <div className={classes.cardActions}>
            <Button
              type="button"
              variant="light"
              size="xs"
              loading={revealPending}
              disabled={Boolean(accessCode)}
              onClick={() => {
                void revealCode();
              }}
            >
              Show code
            </Button>
            {!grant.revokedAt ? (
              <Button
                type="button"
                variant="light"
                size="xs"
                onClick={() => {
                  onManageCapacity(grant);
                }}
              >
                Manage capacity
              </Button>
            ) : null}
            {!grant.revokedAt ? (
              <Button
                color="red"
                variant="light"
                size="xs"
                onClick={() => {
                  onRevoke(grant);
                }}
              >
                Revoke code
              </Button>
            ) : null}
          </div>
        </div>
      </Stack>
    </Paper>
  );
}

function Redemptions({ grant }: { grant: AdminAccessGrant }) {
  if (grant.redemptions.length === 0)
    return (
      <Text size="sm" c="dimmed">
        No redemptions yet.
      </Text>
    );
  return (
    <details>
      <summary className={classes.summary}>
        View redeemed learners ({grant.redeemed})
      </summary>
      <ul className={classes.redemptions}>
        {grant.redemptions.map((redemption) => (
          <li key={redemption.enrollmentId}>
            <div>
              <Text fw={600}>{redemption.learnerName}</Text>
              <Text size="sm" c="dimmed" className={classes.email}>
                {redemption.learnerEmail} · {redemption.state}
              </Text>
            </div>
            <Link
              to="/admin/learners/$userId/enrollments/$enrollmentId"
              params={{
                userId: redemption.learnerId,
                enrollmentId: redemption.enrollmentId,
              }}
              className={classes.reviewLink}
            >
              <Button component="span" variant="light" size="xs">
                Review
              </Button>
            </Link>
          </li>
        ))}
      </ul>
      {grant.redeemed > grant.redemptions.length ? (
        <Text size="xs" c="dimmed" mt="xs">
          Showing the {grant.redemptions.length} most recent redemptions.
        </Text>
      ) : null}
    </details>
  );
}
