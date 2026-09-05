import { useEffect, useState } from "react";
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
  const [queue, setQueue] = useState<EventVirtualLobbyQueueData | null>(null);

  useEffect(() => {
    if (!showQueue) return;
    const load = async () => {
      const result = await getEventVirtualLobbyQueue({
        data: {
          eventOccurrenceId,
          eventSessionId: session.eventSessionId,
          page,
        },
      });
      setQueue(result.status === "ready" ? result.data : null);
    };
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 4_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [eventOccurrenceId, page, session.eventSessionId, showQueue]);

  const entries = queue?.entries ?? [];
  const waiting = entries.some((entry) => entry.state === "waiting");
  return (
    <div className={classes.lobbyPanel}>
      <section>
        <strong>Attendee waiting-room link</strong>
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
        <>
          <header>
            <h4>Waiting room</h4>
            {waiting ? (
              <button
                type="button"
                disabled={
                  processingId === `admit_all-${session.eventSessionId}`
                }
                onClick={() => {
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
                    <strong>{entry.name}</strong>
                    <div>
                      <span data-state={entry.state}>
                        {entry.state.replaceAll("_", " ")}
                      </span>
                      {actions.map((operation) => (
                        <button
                          data-danger={operation !== "admit" || undefined}
                          key={operation}
                          type="button"
                          disabled={processingId === `${operation}-${entry.id}`}
                          onClick={() => {
                            void changeAdmission(
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
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No attendees.</p>
          )}
          {queue && (page > 0 || queue.hasNextPage) ? (
            <nav aria-label="Waiting room pages">
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
        </>
      ) : null}
    </div>
  );
}
