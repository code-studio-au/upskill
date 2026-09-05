import { lazy } from "react";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
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
  mutateEventVirtualLobbyAdmission,
  mutateEventVirtualRoom,
} from "#/server/functions/event-operations";
import type { EventOperationsAction } from "./EventOperationsOverview";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import classes from "./EventOperations.module.css";

const EventOperationsDevicePreview = lazy(async () => {
  const module = await import("./EventOperationsDevicePreview");
  return { default: module.EventOperationsDevicePreview };
});
const EventOperationsLobbyQueue = lazy(async () => {
  const module = await import("./EventOperationsLobbyQueue");
  return { default: module.EventOperationsLobbyQueue };
});

function statusColour(
  status: "pending" | "ready" | "error" | "closed",
): string {
  return status === "ready"
    ? "teal"
    : status === "error"
      ? "red"
      : status === "closed"
        ? "gray"
        : "yellow";
}

type AdmissionAction = "admit" | "decline" | "revoke" | "admit_all";

export function EventOperationsVirtualSessions({
  workspace,
  processingId,
  action,
}: {
  workspace: EventOperationsWorkspace;
  processingId: string | null;
  action: EventOperationsAction;
}) {
  const occurrenceId = workspace.occurrence.id;
  const administrator = workspace.access.roles.includes("administrator");

  const operate = (
    sessionId: string,
    operation:
      | "prepare"
      | "health"
      | "start"
      | "lock"
      | "reopen"
      | "end"
      | "replace"
      | "admission_manual"
      | "admission_automatic",
    confirmation?: string,
  ) => {
    if (confirmation && !window.confirm(confirmation)) return;
    void action(`${operation}-${sessionId}`, () =>
      mutateEventVirtualRoom({
        data: {
          eventOccurrenceId: occurrenceId,
          eventSessionId: sessionId,
          action: operation,
        },
      }),
    );
  };

  const changeAdmission = (
    sessionId: string,
    lobbyEntryId: string | undefined,
    operation: AdmissionAction,
  ) => {
    return action(`${operation}-${lobbyEntryId ?? sessionId}`, () =>
      mutateEventVirtualLobbyAdmission({
        data: {
          eventOccurrenceId: occurrenceId,
          eventSessionId: sessionId,
          lobbyEntryId,
          action: operation,
        },
      }),
    );
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Webinar operations</Title>
        <Text c="dimmed">
          Prepare each LiveKit room and control the attendee door for the exact
          assigned session.
        </Text>
      </div>
      {workspace.occurrence.status !== "published" ? (
        <Alert color="blue">
          LiveKit rooms remain dormant until the event is published. Publication
          stays disabled until the webinar media slice is complete.
        </Alert>
      ) : null}
      <div className={classes.sessionList}>
        {workspace.virtualSessions.map((virtualSession) => {
          const session = workspace.sessions.find(
            (candidate) => candidate.id === virtualSession.eventSessionId,
          );
          const room = virtualSession.room;
          return (
            <Paper
              withBorder
              radius="lg"
              p="md"
              key={virtualSession.eventSessionId}
            >
              <Stack gap="md">
                <Group justify="space-between" align="start">
                  <div>
                    <Title order={3}>
                      {session?.title ?? "Virtual session"}
                    </Title>
                    {session ? (
                      <Text c="dimmed" size="sm">
                        {formatLocalDateTime(session.startsAt, {
                          timeZone: workspace.occurrence.timezone,
                        })}
                      </Text>
                    ) : null}
                  </div>
                  <Group gap="xs">
                    {room ? (
                      <>
                        <Badge variant="light">
                          Generation {room.generation}
                        </Badge>
                        <Badge variant="light">
                          Capacity {room.maxParticipants}
                        </Badge>
                        <Badge
                          color={statusColour(room.providerStatus)}
                          variant="light"
                        >
                          Provider {room.providerStatus}
                        </Badge>
                        <Badge variant="light">Door {room.doorState}</Badge>
                      </>
                    ) : (
                      <Badge color="gray" variant="light">
                        Not prepared
                      </Badge>
                    )}
                  </Group>
                </Group>

                {!room ? (
                  <Stack gap="xs">
                    <Text size="sm">
                      Presenter preparation opens{" "}
                      {formatLocalDateTime(virtualSession.preparationOpensAt, {
                        timeZone: workspace.occurrence.timezone,
                      })}
                      .
                    </Text>
                    <Button
                      disabled={!virtualSession.canEnterGreenRoom}
                      loading={
                        processingId ===
                        `prepare-${virtualSession.eventSessionId}`
                      }
                      onClick={() => {
                        operate(virtualSession.eventSessionId, "prepare");
                      }}
                    >
                      Prepare green room
                    </Button>
                  </Stack>
                ) : (
                  <Stack gap="sm">
                    {room.providerStatus === "error" ? (
                      <Alert color="red">
                        {room.doorState === "ended"
                          ? "Provider closure is pending a background retry. The webinar remains ended."
                          : "The provider room needs attention. Check LiveKit and replace this generation only if retrying cannot recover it."}
                      </Alert>
                    ) : null}
                    <Group gap="sm">
                      {room.doorState === "scheduled" ? (
                        <Button
                          disabled={
                            room.providerStatus !== "ready" ||
                            !virtualSession.canEnterGreenRoom
                          }
                          loading={
                            processingId ===
                            `start-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(
                              virtualSession.eventSessionId,
                              "start",
                              "Start this webinar and open the attendee door?",
                            );
                          }}
                        >
                          Start webinar
                        </Button>
                      ) : null}
                      {room.doorState === "open" ? (
                        <Button
                          variant="light"
                          loading={
                            processingId ===
                            `lock-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(virtualSession.eventSessionId, "lock");
                          }}
                        >
                          Lock doors
                        </Button>
                      ) : null}
                      {room.doorState === "locked" ? (
                        <Button
                          variant="light"
                          loading={
                            processingId ===
                            `reopen-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(virtualSession.eventSessionId, "reopen");
                          }}
                        >
                          Reopen doors
                        </Button>
                      ) : null}
                      {room.doorState !== "ended" ? (
                        <Button
                          color="red"
                          variant="light"
                          loading={
                            processingId ===
                            `end-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(
                              virtualSession.eventSessionId,
                              "end",
                              "End this webinar for everyone?",
                            );
                          }}
                        >
                          End webinar
                        </Button>
                      ) : null}
                      {(room.providerStatus === "error" &&
                        room.doorState !== "ended") ||
                      (administrator && room.doorState === "ended") ? (
                        <Button
                          color="red"
                          variant="outline"
                          loading={
                            processingId ===
                            `replace-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(
                              virtualSession.eventSessionId,
                              "replace",
                              room.doorState === "ended"
                                ? "Recover this ended webinar with a new room generation?"
                                : "Replace this room generation? Existing room credentials will no longer be used.",
                            );
                          }}
                        >
                          {room.doorState === "ended"
                            ? "Recover with new generation"
                            : "Replace generation"}
                        </Button>
                      ) : null}
                    </Group>
                    {room.doorState !== "ended" ? (
                      <Group gap="sm">
                        <Text size="sm" fw={700}>
                          Admission
                        </Text>
                        <Button
                          size="xs"
                          variant={
                            room.admissionMode === "manual"
                              ? "default"
                              : "light"
                          }
                          loading={
                            processingId ===
                            `admission_manual-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(
                              virtualSession.eventSessionId,
                              "admission_manual",
                            );
                          }}
                        >
                          Manual admit
                        </Button>
                        <Button
                          size="xs"
                          variant={
                            room.admissionMode === "automatic"
                              ? "default"
                              : "light"
                          }
                          loading={
                            processingId ===
                            `admission_automatic-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            operate(
                              virtualSession.eventSessionId,
                              "admission_automatic",
                            );
                          }}
                        >
                          Auto-admit
                        </Button>
                      </Group>
                    ) : null}
                  </Stack>
                )}

                <Group gap="sm">
                  <Button
                    variant="subtle"
                    loading={
                      processingId === `health-${virtualSession.eventSessionId}`
                    }
                    onClick={() => {
                      operate(virtualSession.eventSessionId, "health");
                    }}
                  >
                    Check provider
                  </Button>
                </Group>
                {virtualSession.lobbyPath ? (
                  <EventOperationsLobbyQueue
                    eventOccurrenceId={occurrenceId}
                    session={virtualSession}
                    lobbyPath={virtualSession.lobbyPath}
                    showQueue={Boolean(room)}
                    timeZone={workspace.occurrence.timezone}
                    processingId={processingId}
                    changeAdmission={changeAdmission}
                  />
                ) : null}
                <EventOperationsDevicePreview />
              </Stack>
            </Paper>
          );
        })}
      </div>
    </Stack>
  );
}
