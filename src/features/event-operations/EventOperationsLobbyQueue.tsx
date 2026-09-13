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
    let stopped: boolean | undefined;
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
    let pending: Promise<void> | undefined;
    const poll = () => {
      pending ??= load().finally(() => {
        pending = undefined;
      });
    };
    poll();
    const timer = setInterval(() => {
      if (!document.hidden) poll();
    }, 4_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [eventOccurrenceId, page, sessionId]);

  const entries = queue?.entries ?? [];
  const recording = queue === undefined ? session.recording : queue?.recording;
  const webinarEnded = (queue?.doorState ?? room.doorState) === "ended";
  const waiting = entries.some((entry) => entry.state === "waiting");
  const admissionBusy = !!processingId;
  return (
    <section
      className={classes.queuePanel}
      aria-label="Learners"
      data-r={recording?.status}
    >
      {webinarEnded && recording?.statusLabel ? (
        <p className={classes.recordingPanel} role="status">
          {recording.statusLabel}
        </p>
      ) : null}
      {recording?.warning ? (
        <p className={classes.recordingPanel} role="alert">
          {recording.warning}
        </p>
      ) : null}
      <header className={classes.queueHeader}>
        <div>
          <h4>Learners</h4>
          <p>
            {queue?.connectedCount ?? "—"} / {session.learnerCapacity} (max)
            connected
          </p>
        </div>
        <div className={classes.queueControls}>
          {!webinarEnded ? (
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

      {queue === undefined ? <p role="status">Loading…</p> : null}
      {queue === null ? (
        <p role="alert" className={classes.queueError}>
          Retrying…
        </p>
      ) : null}
      {queue && entries.length ? (
        <ul className={classes.lobbyQueue}>
          {entries.map((entry) => {
            const actions =
              entry.state === "waiting"
                ? ([
                    ["admit", "Admit"],
                    ["decline", "Decline"],
                  ] as const)
                : ([["revoke", "Revoke"]] as const);
            return (
              <li className={classes.lobbyEntry} key={entry.id}>
                <div className={classes.learnerIdentity}>
                  <strong>{entry.name}</strong>
                  <span>{entry.statusLabel}</span>
                </div>
                <div className={classes.attendeeActions}>
                  {actions.map(([operation, label]) => {
                    return (
                      <button
                        data-danger={operation !== "admit"}
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
      {queue && !entries.length ? (
        <strong className={classes.emptyQueue}>Empty</strong>
      ) : null}
      {queue && (page || queue.hasNextPage) ? (
        <nav className={classes.queuePagination} aria-label="Learner pages">
          <button
            type="button"
            disabled={!page}
            onClick={() => {
              setPage(page - 1);
            }}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!queue.hasNextPage}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
