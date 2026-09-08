import { useEffect, useRef, useState } from "react";
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
  lobbyPath,
  showQueue,
  processingId,
  changeAdmission,
}: {
  eventOccurrenceId: string;
  session: VirtualSession;
  lobbyPath: string;
  showQueue: boolean;
  processingId: string | null;
  changeAdmission: (
    sessionId: string,
    entryId: string | undefined,
    operation: AdmissionAction,
  ) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [queue, setQueue] = useState<
    EventVirtualLobbyQueueData | null | undefined
  >();
  const revision = useRef<string | null>(null);

  useEffect(() => {
    if (!showQueue) return;
    let stopped = false;
    const load = async () => {
      const result = await getEventVirtualLobbyQueue({
        data: {
          eventOccurrenceId,
          eventSessionId: session.eventSessionId,
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
  }, [eventOccurrenceId, page, session.eventSessionId, showQueue]);

  const entries = queue?.entries ?? [];
  const waiting = entries.some((entry) => entry.state === "waiting");
  const admissionBusy = processingId !== null;

  return (
    <div className={classes.lobbyPanel}>
      <section className={classes.lobbyLinkPanel}>
        <strong>Attendee lobby link</strong>
        <a
          className={classes.guestLink}
          href={lobbyPath}
          target="_blank"
          rel="noreferrer"
        >
          {lobbyPath}
        </a>
      </section>
      {showQueue ? (
        <section
          className={classes.queuePanel}
          aria-labelledby={`waiting-room-${session.eventSessionId}`}
          aria-busy={admissionBusy || queue === undefined}
        >
          <header className={classes.queueHeader}>
            <div>
              <h4 id={`waiting-room-${session.eventSessionId}`}>
                Attendee admission
              </h4>
              <p>Updates live.</p>
            </div>
            {waiting ? (
              <button
                type="button"
                disabled={admissionBusy}
                onClick={() => {
                  setPage(0);
                  void changeAdmission(
                    session.eventSessionId,
                    undefined,
                    "admit_all",
                  );
                }}
              >
                Admit all
              </button>
            ) : null}
          </header>

          {queue === undefined ? (
            <p role="status">Checking the attendee lobby…</p>
          ) : null}
          {queue === null ? (
            <p role="alert" className={classes.queueError}>
              Attendee list unavailable. Retrying…
            </p>
          ) : null}
          {queue && entries.length ? (
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
                    <strong>{entry.name}</strong>
                    <div className={classes.attendeeActions}>
                      <span data-state={entry.state}>
                        {entry.state.replaceAll("_", " ")}
                      </span>
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
                              void changeAdmission(
                                session.eventSessionId,
                                entry.id,
                                operation,
                              );
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
              <strong>No attendees in the lobby</strong>
              <p>New arrivals will appear here automatically.</p>
            </div>
          ) : null}
          {queue && (page > 0 || queue.hasNextPage) ? (
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
      ) : null}
    </div>
  );
}
