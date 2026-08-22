import {
  Alert,
  Button,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { formatLocalDate } from "#/features/shared/local-date";
import { PageTabs } from "#/features/shared/PageTabs";
import {
  revealAdminAccessGrantCode,
  revokeAdminAccessGrant,
} from "#/server/functions/admin-access-grant";
import type { AdminAccessGrant } from "./admin-access.schema";
import { AdminAccessGrantCapacityDialog } from "./AdminAccessGrantCapacityDialog";
import classes from "./AdminAccessGrantManager.module.css";

const AdminAccessGrantRedemptionTable = lazy(async () => {
  const module = await import("./AdminAccessGrantRedemptionTable");
  return { default: module.AdminAccessGrantRedemptionTable };
});

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
  const [grantView, setGrantView] = useState<"active" | "revoked">("active");
  const activeGrants = grants.filter((grant) => !grant.revokedAt);
  const revokedGrants = grants.filter((grant) => grant.revokedAt);
  const visibleGrants = grantView === "revoked" ? revokedGrants : activeGrants;

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
    <section aria-label="Access grants">
      <Stack gap="md">
        <PageTabs
          label="Access grant status"
          value={grantView}
          tabs={[
            {
              value: "active",
              label: `Active (${String(activeGrants.length)})`,
            },
            {
              value: "revoked",
              label: `Revoked (${String(revokedGrants.length)})`,
            },
          ]}
          onChange={setGrantView}
        />
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
        {visibleGrants.length === 0 ? (
          <Alert title={`No ${grantView} grants`}>
            {grantView === "active"
              ? "Create the first organisation access code."
              : "Revoked grants will appear here."}
          </Alert>
        ) : (
          <div className={classes.grantGrid}>
            {visibleGrants.map((grant) => (
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
                : capacityGrant.fulfillmentMode === "single_use_codes"
                  ? "Access capacity updated and additional single-use codes generated."
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
          {grant.offeringTitle} · {grant.offeringDetail}
        </Text>
        <dl className={classes.metrics}>
          <div>
            <dt>Enrolments</dt>
            <dd>
              {grant.redeemed} of {grant.quantity}
            </dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>
              {grant.enrollmentDurationDays === null
                ? "Event place"
                : `${String(grant.enrollmentDurationDays)} days`}
            </dd>
          </div>
          <div>
            <dt>Code expiry</dt>
            <dd>
              {grant.expiresAt ? formatLocalDate(grant.expiresAt) : "None"}
            </dd>
          </div>
        </dl>
        <details
          className={classes.grantDetails}
          onToggle={(event) => {
            setDetailsOpen(event.currentTarget.open);
          }}
        >
          <summary className={classes.summary}>Grant details</summary>
          <div className={classes.detailContent}>
            <div className={classes.tags}>
              <Badge variant="light">
                {grant.kind === "enterprise_contract"
                  ? "Enterprise"
                  : "Bulk purchase"}
              </Badge>
              <Badge variant="light" color="gray">
                {grant.fulfillmentMode === "single_use_codes"
                  ? "Single-use codes"
                  : "Shared code"}
              </Badge>
              {grant.customerExtendable ? (
                <Badge variant="light" color="gray">
                  Owner-extendable
                </Badge>
              ) : null}
            </div>
            <Text size="sm" c="dimmed">
              {grant.domains.length > 0
                ? `Domains: ${grant.domains.join(", ")}`
                : "No domain restriction"}
            </Text>
            <Text size="sm" c="dimmed">
              Owner emails:{" "}
              {grant.owners.map((owner) => owner.email).join(", ")}
            </Text>
            {detailsOpen ? (
              <Suspense
                fallback={
                  <Text size="sm" c="dimmed">
                    Loading redemptions…
                  </Text>
                }
              >
                <AdminAccessGrantRedemptionTable
                  accessGrantId={grant.id}
                  expectedTotal={grant.redeemed}
                />
              </Suspense>
            ) : null}
          </div>
        </details>
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
        <div className={classes.cardFooter}>
          <Text size="xs" c="dimmed">
            Created {formatLocalDate(grant.createdAt)}
          </Text>
          <div className={classes.cardActions}>
            {grant.fulfillmentMode === "shared_code" ? (
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
            ) : null}
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
