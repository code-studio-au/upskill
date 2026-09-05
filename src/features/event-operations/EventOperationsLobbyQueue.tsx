import { useCallback, useEffect, useState } from "react";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Group, Stack, Text, Title } from "#/features/shared/mantine";
import { getEventVirtualLobbyQueue } from "#/server/functions/event-operations";
import type {
  EventOperationsWorkspace,
  EventVirtualLobbyQueueData,
} from "./event-operations.schema";
import classes from "./EventOperations.module.css";

type VirtualSession = EventOperationsWorkspace["virtualSessions"][number];
type LobbyEntry = EventVirtualLobbyQueueData["entries"][number];
type AdmissionAction = "admit" | "decline" | "revoke" | "admit_all";

function statusColour(status: LobbyEntry["state"]): string {
  return status === "waiting" ? "yellow" : "teal";
}

export function EventOperationsLobbyQueue({
  eventOccurrenceId,
  session,
  lobbyPath,
  showQueue,
  timeZone,
  processingId,
  changeAdmission,
}: {
  eventOccurrenceId: string;
  session: VirtualSession;
  lobbyPath: string;
  showQueue: boolean;
  timeZone: string;
  processingId: string | null;
  changeAdmission: (
    sessionId: string,
    entryId: string | undefined,
    operation: AdmissionAction,
  ) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<EventVirtualLobbyQueueData | null>(null);
  const loadQueue = useCallback(async () => {
    const result = await getEventVirtualLobbyQueue({
      data: {
        eventOccurrenceId,
        eventSessionId: session.eventSessionId,
        page,
      },
    });
    setQueue(result.status === "ready" ? result.data : null);
  }, [eventOccurrenceId, page, session.eventSessionId]);

  useEffect(() => {
    if (!showQueue) return;
    const initial = window.setTimeout(() => void loadQueue(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadQueue();
    }, 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [loadQueue, showQueue]);

  const entries = queue?.entries ?? [];
  const waiting = entries.some((entry) => entry.state === "waiting");
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
                  void changeAdmission(
                    session.eventSessionId,
                    undefined,
                    "admit_all",
                  ).then(loadQueue);
                }}
              >
                Admit all
              </Button>
            ) : null}
          </Group>
          {entries.length ? (
            <ul className={classes.lobbyQueue}>
              {entries.map((entry) => {
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
                            void changeAdmission(
                              session.eventSessionId,
                              entry.id,
                              operation,
                            ).then(loadQueue);
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
              No active attendees.
            </Text>
          )}
          {queue && (page > 0 || queue.hasNextPage) ? (
            <Group justify="space-between">
              <Button
                size="xs"
                variant="subtle"
                disabled={page === 0}
                onClick={() => {
                  setPage((current) => Math.max(0, current - 1));
                }}
              >
                Previous
              </Button>
              <Button
                size="xs"
                variant="subtle"
                disabled={!queue.hasNextPage}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </Button>
            </Group>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
