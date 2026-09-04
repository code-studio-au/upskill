import { useEffect, useRef, useState } from "react";
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
  checkEventVirtualRoomProvider,
  mutateEventVirtualRoomLifecycle,
  prepareEventVirtualRoom,
  setEventVirtualRoomAdmission,
} from "#/server/functions/event-operations";
import type { EventOperationsAction } from "./EventOperationsOverview";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import classes from "./EventOperations.module.css";

function DevicePreview() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [stream]);

  const stop = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    setStream(null);
  };

  const start = async () => {
    setError(null);
    try {
      setStream(
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
      );
    } catch {
      setError(
        "Camera or microphone access was unavailable. Check this browser's site permissions and try again.",
      );
    }
  };

  return (
    <Stack gap="sm">
      <div>
        <Text fw={700}>Device preview</Text>
        <Text c="dimmed" size="sm">
          This preview stays on this device and does not connect to the webinar.
        </Text>
      </div>
      {stream ? (
        <video
          ref={video}
          className={classes.devicePreview}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
        />
      ) : null}
      {error ? <Alert color="red">{error}</Alert> : null}
      <Button
        variant="light"
        onClick={() => {
          if (stream) stop();
          else void start();
        }}
      >
        {stream ? "Stop preview" : "Test camera and microphone"}
      </Button>
    </Stack>
  );
}

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

  const lifecycle = (
    sessionId: string,
    operation: "start" | "lock" | "reopen" | "end" | "replace",
  ) =>
    action(`${operation}-${sessionId}`, () =>
      mutateEventVirtualRoomLifecycle({
        data: {
          eventOccurrenceId: occurrenceId,
          eventSessionId: sessionId,
          action: operation,
        },
      }),
    );

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Webinar operations</Title>
        <Text c="dimmed">
          Prepare each LiveKit room, check local devices, and control the
          attendee door for the exact assigned session.
        </Text>
      </div>
      {workspace.occurrence.status !== "published" ? (
        <Alert color="blue">
          LiveKit rooms remain dormant until the event is published. Publication
          stays disabled until the attendee lobby and webinar media slices are
          complete.
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
                      onClick={() =>
                        void action(
                          `prepare-${virtualSession.eventSessionId}`,
                          () =>
                            prepareEventVirtualRoom({
                              data: {
                                eventOccurrenceId: occurrenceId,
                                eventSessionId: virtualSession.eventSessionId,
                              },
                            }),
                        )
                      }
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
                          disabled={room.providerStatus !== "ready"}
                          loading={
                            processingId ===
                            `start-${virtualSession.eventSessionId}`
                          }
                          onClick={() =>
                            void lifecycle(
                              virtualSession.eventSessionId,
                              "start",
                            )
                          }
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
                          onClick={() =>
                            void lifecycle(
                              virtualSession.eventSessionId,
                              "lock",
                            )
                          }
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
                          onClick={() =>
                            void lifecycle(
                              virtualSession.eventSessionId,
                              "reopen",
                            )
                          }
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
                            if (
                              window.confirm("End this webinar for everyone?")
                            )
                              void lifecycle(
                                virtualSession.eventSessionId,
                                "end",
                              );
                          }}
                        >
                          End webinar
                        </Button>
                      ) : null}
                      {room.providerStatus === "error" &&
                      room.doorState !== "ended" ? (
                        <Button
                          color="red"
                          variant="outline"
                          loading={
                            processingId ===
                            `replace-${virtualSession.eventSessionId}`
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                "Replace this room generation? Existing room credentials will no longer be used.",
                              )
                            )
                              void lifecycle(
                                virtualSession.eventSessionId,
                                "replace",
                              );
                          }}
                        >
                          Replace generation
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
                            `admission-manual-${virtualSession.eventSessionId}`
                          }
                          onClick={() =>
                            void action(
                              `admission-manual-${virtualSession.eventSessionId}`,
                              () =>
                                setEventVirtualRoomAdmission({
                                  data: {
                                    eventOccurrenceId: occurrenceId,
                                    eventSessionId:
                                      virtualSession.eventSessionId,
                                    admissionMode: "manual",
                                  },
                                }),
                            )
                          }
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
                            `admission-automatic-${virtualSession.eventSessionId}`
                          }
                          onClick={() =>
                            void action(
                              `admission-automatic-${virtualSession.eventSessionId}`,
                              () =>
                                setEventVirtualRoomAdmission({
                                  data: {
                                    eventOccurrenceId: occurrenceId,
                                    eventSessionId:
                                      virtualSession.eventSessionId,
                                    admissionMode: "automatic",
                                  },
                                }),
                            )
                          }
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
                    onClick={() =>
                      void action(
                        `health-${virtualSession.eventSessionId}`,
                        () =>
                          checkEventVirtualRoomProvider({
                            data: {
                              eventOccurrenceId: occurrenceId,
                              eventSessionId: virtualSession.eventSessionId,
                            },
                          }),
                      )
                    }
                  >
                    Check provider
                  </Button>
                </Group>
                <DevicePreview />
              </Stack>
            </Paper>
          );
        })}
      </div>
    </Stack>
  );
}
