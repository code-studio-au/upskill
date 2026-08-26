import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { AdminAdministratorDirectory } from "#/features/admin/admin.schema";
import { AccountInviteDialog } from "#/features/shared/AccountInviteDialog";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { AdminDirectoryHeader } from "#/features/admin/AdminDirectory";
import { Badge } from "#/features/shared/Badge";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
} from "#/features/shared/mantine";
import {
  getAdminAdministrators,
  invitePlatformAdministrator,
  removePlatformAdministrator,
} from "#/server/functions/admin";

export const Route = createFileRoute("/admin/administrators")({
  ssr: false,
  loader: async () => {
    const result = await getAdminAdministrators();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/administrators" },
      });
    return result;
  },
  component: AdministratorsPage,
});

function AdministratorsPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return <AdministratorDirectory directory={result.data} />;
}

function AdministratorDirectory({
  directory,
}: {
  directory: AdminAdministratorDirectory;
}) {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<
    (typeof directory.administrators)[number] | null
  >(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack gap="lg">
      <AdminDirectoryHeader
        headingId="administrator-directory-heading"
        eyebrow="Access control"
        title="Administrators"
        count={`${String(directory.administrators.length)} ${directory.administrators.length === 1 ? "administrator" : "administrators"}`}
      />
      <Group justify="space-between" align="center">
        <Text c="dimmed" size="sm">
          Administrator access is separate from learner and event-staff
          responsibilities.
        </Text>
        <Button
          onClick={() => {
            setInviting(true);
            setError(null);
            setMessage(null);
          }}
        >
          Add administrator
        </Button>
      </Group>
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
      <Stack gap="sm">
        {directory.administrators.map((administrator) => (
          <Paper withBorder radius="lg" p="md" key={administrator.userId}>
            <Group justify="space-between" align="center" wrap="wrap">
              <div>
                <Group gap="xs">
                  <Text fw={700}>{administrator.name}</Text>
                  <Badge variant="light">
                    {administrator.status === "active"
                      ? "Active"
                      : "Setup pending"}
                  </Badge>
                </Group>
                <Text c="dimmed" size="sm">
                  {administrator.email}
                </Text>
              </div>
              <Button
                color="red"
                variant="light"
                disabled={administrator.userId === directory.currentUserId}
                onClick={() => {
                  setRemoving(administrator);
                  setError(null);
                  setMessage(null);
                }}
              >
                {administrator.status === "pending"
                  ? "Cancel invitation"
                  : "Revoke access"}
              </Button>
            </Group>
          </Paper>
        ))}
      </Stack>
      {inviting ? (
        <AccountInviteDialog
          title="Add administrator"
          description="Existing verified accounts receive access immediately. New people receive the normal secure account-setup email and become administrators only after activation."
          submitLabel="Add administrator"
          onClose={() => {
            setInviting(false);
          }}
          onInvite={async (input) => {
            const outcome = await invitePlatformAdministrator({ data: input });
            if (outcome.status === "conflict")
              return "That person is already an administrator.";
            if (outcome.status !== "ready")
              return "Administrator access could not be added.";
            setMessage(
              outcome.data.outcome === "granted"
                ? "Administrator access granted."
                : outcome.data.outcome === "pending"
                  ? "An administrator invitation is already pending."
                  : "Administrator invitation queued; access begins after account setup.",
            );
            setInviting(false);
            await router.invalidate();
            return null;
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmationDialog
          title={
            removing.status === "pending"
              ? "Cancel administrator invitation?"
              : "Revoke administrator access?"
          }
          description={
            removing.status === "pending"
              ? `${removing.name} will remain a normal user, but account activation will no longer grant administrator access.`
              : `${removing.name} will immediately lose platform administration access. Their account and historical actions remain retained.`
          }
          confirmLabel={
            removing.status === "pending"
              ? "Cancel invitation"
              : "Revoke access"
          }
          confirmColor="red"
          pending={pending}
          onCancel={() => {
            setRemoving(null);
          }}
          onConfirm={() => {
            setPending(true);
            void removePlatformAdministrator({
              data: { userId: removing.userId },
            })
              .then(async (outcome) => {
                if (outcome.status === "ready") {
                  setMessage(
                    outcome.data.outcome === "revoked"
                      ? "Administrator access revoked."
                      : "Administrator invitation cancelled.",
                  );
                  setRemoving(null);
                  await router.invalidate();
                  return;
                }
                setError(
                  outcome.status === "conflict" &&
                    outcome.reason === "event_responsibility"
                    ? `Replace this administrator in ${String(outcome.eventAssignmentCount ?? 0)} active Event Instance assignment(s) and ${String(outcome.templateDefaultCount ?? 0)} current Event Template default(s) first.`
                    : outcome.status === "conflict" &&
                        outcome.reason === "last_administrator"
                      ? "The final administrator cannot be removed."
                      : "Administrator access could not be removed.",
                );
                setRemoving(null);
              })
              .finally(() => {
                setPending(false);
              });
          }}
        />
      ) : null}
    </Stack>
  );
}
