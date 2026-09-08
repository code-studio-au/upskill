import { useEffect, useRef, useState } from "react";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { getEventVirtualLobbyQueue } from "#/server/functions/event-operations";
import type {
  EventOperationsWorkspace,
  EventVirtualLobbyQueueData,
} from "./event-operations.schema";
import classes from "./EventOperations.module.css";

type VirtualSession = EventOperationsWorkspace["virtualSessions"][number];
type AdmissionAction = "admit" | "decline" | "revoke" | "admit_all";

export function EventOperationsLobbyQueue({
  eventOccurrenceId,
  session,
  room,
  processingId,
  changeAdmission,
  changeAdmissionMode,
}: {
  eventOccurrenceId: string;
  session: VirtualSession;
  room: NonNullable<VirtualSession["room"]>;
  processingId: string | null;
  changeAdmission: (
    sessionId: string,
    entryId: string | undefined,
    operation: AdmissionAction,
  ) => Promise<void>;
  changeAdmissionMode: (
    sessionId: string,
    mode: "manual" | "automatic",
  ) => void;
}) {
  const sessionId = session.eventSessionId;
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<
    EventVirtualLobbyQueueData | null | undefined
  >();
  const revision = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const result = await getEventVirtualLobbyQueue({
        data: {
          eventOccurrenceId,
          eventSessionId: sessionId,
          page,
        },
      });
      if (stopped) return;
      if (result.status !== "ready") {
        setQueue(null);
        return;
      }
      const changed = revision.current && revision.current !== result.data.etag;
      revision.current = result.data.etag;
      if (page && changed) {
        setPage(0);
        return;
      }
      setQueue(result.data);
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 4_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [eventOccurrenceId, page, sessionId]);

  const entries = queue?.entries ?? [];
  const waiting = entries.some((entry) => entry.state === "waiting");
  const admissionBusy = processingId !== null;
  return (
    <section className={classes.queuePanel} aria-label="Learner admission">
      <header className={classes.queueHeader}>
        <div>
          <h4>Learners</h4>
          <p className={classes.connectionCount}>
            {room.maxParticipants} maximum connections
          </p>
        </div>
        <div className={classes.queueControls}>
          {room.doorState !== "ended" ? (
            <MantineNativeSelect
              label="Admission mode"
              value={room.admissionMode}
              disabled={admissionBusy}
              data={[
                { value: "manual", label: "Manual" },
                { value: "automatic", label: "Automatic" },
              ]}
              onChange={(event) => {
                changeAdmissionMode(
                  sessionId,
                  event.currentTarget.value as "manual" | "automatic",
                );
              }}
            />
          ) : null}
          {waiting ? (
            <button
              type="button"
              disabled={admissionBusy}
              onClick={() => {
                setPage(0);
                void changeAdmission(sessionId, undefined, "admit_all");
              }}
            >
              Admit all
            </button>
          ) : null}
        </div>
      </header>

      {queue === undefined ? <p role="status">Checking lobby…</p> : null}
      {queue === null ? (
        <p role="alert" className={classes.queueError}>
          Learner list unavailable. Retrying…
        </p>
      ) : null}
      {queue && entries.length ? (
        <ul className={classes.lobbyQueue}>
          {entries.map((entry) => {
            const admissionLabel =
              entry.state === "waiting"
                ? "Waiting"
                : entry.state === "admitted"
                  ? "Admitted"
                  : "Access issued";
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
                <div className={classes.learnerIdentity}>
                  <strong>{entry.name}</strong>
                  <span>{admissionLabel}</span>
                </div>
                <div className={classes.attendeeActions}>
                  {actions.map((operation) => {
                    const label =
                      operation === "admit"
                        ? "Admit"
                        : operation === "decline"
                          ? "Decline"
                          : "Revoke access";
                    return (
                      <button
                        data-danger={operation !== "admit" || undefined}
                        key={operation}
                        type="button"
                        disabled={admissionBusy}
                        aria-label={`${label} for ${entry.name}`}
                        onClick={() => {
                          setPage(0);
                          void changeAdmission(sessionId, entry.id, operation);
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {queue && entries.length === 0 ? (
        <div className={classes.emptyQueue}>
          <strong>No learners in the lobby</strong>
        </div>
      ) : null}
      {queue && (page || queue.hasNextPage) ? (
        <nav
          className={classes.queuePagination}
          aria-label="Attendee list pages"
        >
          <button
            type="button"
            disabled={page === 0}
            onClick={() => {
              setPage((current) => Math.max(0, current - 1));
            }}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!queue.hasNextPage}
            onClick={() => {
              setPage((current) => current + 1);
            }}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
