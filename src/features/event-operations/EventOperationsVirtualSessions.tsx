import { lazy, Suspense } from "react";
import { formatLocalDateTime } from "#/features/shared/local-date";
import {
  Alert,
  Button,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { mutateEventVirtualRoom } from "#/server/functions/event-operations";
import type { EventOperationsAction } from "./EventOperationsOverview";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import classes from "./EventOperations.module.css";

const EventOperationsLobbyQueue = lazy(async () => {
  const module = await import("./EventOperationsLobbyQueue");
  return { default: module.EventOperationsLobbyQueue };
});
const EventOperationsRecordingPanel = lazy(
  () => import("./EventOperationsRecordingPanel"),
);
const LiveKitPresenterRoom = lazy(async () => {
  const module = await import("./LiveKitPresenterRoom");
  return { default: module.LiveKitPresenterRoom };
});

type AdmissionAction = "admit" | "decline" | "revoke" | "admit_all";
type Room = NonNullable<
  EventOperationsWorkspace["virtualSessions"][number]["room"]
>;

function roomPresentation(room: Room | null) {
  if (!room) return ["unprepared", "Not prepared"] as const;
  if (room.providerStatus === "error")
    return ["error", "Provider issue"] as const;
  if (room.doorState === "ended") return ["ended", "Ended"] as const;
  if (room.doorState === "open") return ["live", "Live · Doors open"] as const;
  if (room.doorState === "locked")
    return ["live", "Live · Doors locked"] as const;
  return room.providerStatus === "ready"
    ? (["ready", "Green room ready"] as const)
    : (["preparing", "Preparing room"] as const);
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
  const administrator = workspace.access.roles.includes("administrator");
  const operate = (
    sessionId: string,
    operation:
      | "prepare"
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
      mutateEventVirtualRoom({
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
      </div>
      {workspace.occurrence.status !== "published" ? (
        <Alert color="blue">
          Publish after checking LiveKit configuration, capacity and staff
          coverage.
        </Alert>
      ) : null}
      <div className={classes.sessionList}>
        {workspace.virtualSessions.map((virtualSession) => {
          const session = workspace.sessions.find(
            (candidate) => candidate.id === virtualSession.eventSessionId,
          );
          const room = virtualSession.room;
          const [roomState, roomLabel] = roomPresentation(room);
          const actionBusy = processingId !== null;
          return (
            <Paper
              withBorder
              radius="lg"
              p="md"
              key={virtualSession.eventSessionId}
            >
              <Stack gap="md">
                <header className={classes.webinarSessionHeader}>
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
                </header>

                {!room ? (
                  <section className={classes.webinarLifecyclePanel}>
                    <div className={classes.webinarLifecycleCopy}>
                      <span
                        className={classes.webinarStatus}
                        data-state={roomState}
                        role="status"
                      >
                        <span aria-hidden="true" />
                        {roomLabel}
                      </span>
                      <Text size="sm">
                        Preparation opens{" "}
                        {formatLocalDateTime(
                          virtualSession.preparationOpensAt,
                          {
                            timeZone: workspace.occurrence.timezone,
                          },
                        )}
                        .
                      </Text>
                    </div>
                    <Button
                      disabled={actionBusy || !virtualSession.canEnterGreenRoom}
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
                  </section>
                ) : (
                  <Stack gap="sm">
                    {room.providerStatus === "error" ? (
                      <Alert color="red">
                        {room.doorState === "ended"
                          ? "Provider closure is pending a background retry. The webinar remains ended."
                          : "The provider room needs attention. Check LiveKit and replace this generation only if retrying cannot recover it."}
                      </Alert>
                    ) : null}
                    <section
                      className={classes.webinarLifecyclePanel}
                      aria-label="Webinar controls"
                    >
                      <div className={classes.webinarLifecycleCopy}>
                        <span
                          className={classes.webinarStatus}
                          data-state={roomState}
                          role="status"
                        >
                          <span aria-hidden="true" />
                          {roomLabel}
                        </span>
                      </div>
                      <div className={classes.webinarLifecycleActions}>
                        {room.doorState === "scheduled" ? (
                          <Button
                            disabled={
                              actionBusy ||
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
                            disabled={actionBusy}
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
                            disabled={actionBusy}
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
                            disabled={actionBusy}
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
                            disabled={actionBusy}
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
                      </div>
                    </section>
                  </Stack>
                )}

                {administrator && virtualSession.recordings.length > 0 ? (
                  <Suspense fallback={null}>
                    <EventOperationsRecordingPanel
                      eventOccurrenceId={occurrenceId}
                      timezone={workspace.occurrence.timezone}
                      recordings={virtualSession.recordings}
                      processingId={processingId}
                      action={action}
                    />
                  </Suspense>
                ) : null}

                {room?.providerStatus === "ready" &&
                room.doorState !== "ended" &&
                virtualSession.canEnterGreenRoom ? (
                  <Suspense
                    fallback={
                      <Text role="status" size="sm">
                        Loading green-room controls…
                      </Text>
                    }
                  >
                    <LiveKitPresenterRoom
                      eventOccurrenceId={occurrenceId}
                      eventSessionId={virtualSession.eventSessionId}
                      presenterRecordingNotice={
                        virtualSession.presenterRecordingNotice
                      }
                      record={
                        !!virtualSession.recording &&
                        virtualSession.recording.status !== "failed"
                      }
                    />
                  </Suspense>
                ) : null}

                {virtualSession.lobbyPath ? (
                  <div className={classes.lobbyPanel}>
                    {room ? (
                      <EventOperationsLobbyQueue
                        eventOccurrenceId={occurrenceId}
                        session={virtualSession}
                        room={room}
                        processingId={processingId}
                        changeAdmission={changeAdmission}
                        changeAdmissionMode={(sessionId, mode) => {
                          operate(
                            sessionId,
                            mode === "manual"
                              ? "admission_manual"
                              : "admission_automatic",
                          );
                        }}
                      />
                    ) : null}
                    <section className={classes.lobbyLinkPanel}>
                      <strong>Attendee lobby link</strong>
                      <a
                        className={classes.guestLink}
                        href={virtualSession.lobbyPath}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {virtualSession.lobbyPath}
                      </a>
                    </section>
                  </div>
                ) : null}
              </Stack>
            </Paper>
          );
        })}
      </div>
    </Stack>
  );
}
