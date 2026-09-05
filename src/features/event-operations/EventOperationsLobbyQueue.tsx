import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import classes from "./EventOperations.module.css";

type VirtualSession = EventOperationsWorkspace["virtualSessions"][number];
type LobbyEntry = VirtualSession["lobbyEntries"][number];
type AdmissionAction = "admit" | "decline" | "revoke" | "admit_all";

function statusColour(status: LobbyEntry["state"]): string {
  if (["admitted", "token_issued", "connected"].includes(status)) return "teal";
  if (["declined", "revoked"].includes(status)) return "red";
  return status === "waiting" ? "yellow" : "gray";
}

export function EventOperationsLobbyQueue({
  session,
  lobbyPath,
  showQueue,
  timeZone,
  processingId,
  changeAdmission,
}: {
  session: VirtualSession;
  lobbyPath: string;
  showQueue: boolean;
  timeZone: string;
  processingId: string | null;
  changeAdmission: (
    sessionId: string,
    entryId: string | undefined,
    operation: AdmissionAction,
  ) => void;
}) {
  const waiting = session.lobbyEntries.some(
    (entry) => entry.state === "waiting",
  );
  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <Text size="sm" fw={700}>
          Attendee waiting-room link
        </Text>
        <Text className={classes.guestLink}>{lobbyPath}</Text>
        <Group gap="sm">
          <Button
            component="a"
            href={lobbyPath}
            target="_blank"
            rel="noreferrer"
            variant="light"
          >
            Open waiting room
          </Button>
          <Button
            variant="subtle"
            onClick={() => {
              void navigator.clipboard.writeText(
                new URL(lobbyPath, window.location.origin).toString(),
              );
            }}
          >
            Copy link
          </Button>
        </Group>
      </Stack>
      {showQueue ? (
        <>
          <Group justify="space-between">
            <Title order={4}>Waiting room</Title>
            {waiting ? (
              <Button
                size="xs"
                variant="light"
                loading={processingId === `admit_all-${session.eventSessionId}`}
                onClick={() => {
                  changeAdmission(
                    session.eventSessionId,
                    undefined,
                    "admit_all",
                  );
                }}
              >
                Admit all
              </Button>
            ) : null}
          </Group>
          {session.lobbyEntries.length ? (
            <ul className={classes.lobbyQueue}>
              {session.lobbyEntries.map((entry) => {
                const actions =
                  entry.state === "waiting"
                    ? (["admit", "decline"] as const)
                    : (
                          ["admitted", "token_issued", "connected"] as string[]
                        ).includes(entry.state)
                      ? (["revoke"] as const)
                      : [];
                return (
                  <li className={classes.lobbyEntry} key={entry.id}>
                    <div>
                      <Text fw={700}>{entry.name}</Text>
                      <Text c="dimmed" size="sm">
                        Requested{" "}
                        {formatLocalDateTime(entry.requestedAt, { timeZone })}
                      </Text>
                    </div>
                    <Group gap="xs">
                      <Badge color={statusColour(entry.state)} variant="light">
                        {entry.state.replaceAll("_", " ")}
                      </Badge>
                      {actions.map((operation) => (
                        <Button
                          key={operation}
                          size="xs"
                          {...(operation === "admit"
                            ? {}
                            : {
                                color: "red" as const,
                                variant: "light" as const,
                              })}
                          loading={processingId === `${operation}-${entry.id}`}
                          onClick={() => {
                            changeAdmission(
                              session.eventSessionId,
                              entry.id,
                              operation,
                            );
                          }}
                        >
                          {operation === "admit"
                            ? "Admit"
                            : operation === "decline"
                              ? "Decline"
                              : "Revoke"}
                        </Button>
                      ))}
                    </Group>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Text c="dimmed" size="sm">
              No attendees are waiting yet.
            </Text>
          )}
        </>
      ) : null}
    </Stack>
  );
}
