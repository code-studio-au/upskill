import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button } from "#/features/shared/mantine";
import { mutateEventVirtualRecording } from "#/server/functions/event-operations";
import type { EventOperationsAction } from "./EventOperationsOverview";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import {
  formatRecordingDuration,
  formatRecordingSize,
} from "./event-operations-recording-format";
import classes from "./EventOperations.module.css";

type Recording = NonNullable<
  EventOperationsWorkspace["virtualSessions"][number]["recordings"][number]
>;

function EventOperationsRecordingPanel({
  eventOccurrenceId,
  timezone,
  recordings,
  processingId,
  action,
}: {
  eventOccurrenceId: string;
  timezone: string;
  recordings: Recording[];
  processingId: string | null;
  action: EventOperationsAction;
}) {
  return (
    <section className={classes.recordingSummary}>
      <h4>Recordings</h4>
      {recordings.map((recording) => {
        const details = recording.details;
        const recordingId = recording.recordingId;
        const deletion = recording.deletion;
        const deletionAction =
          deletion?.status === "failed"
            ? "retry"
            : !deletion &&
                (recording.status === "complete" ||
                  recording.status === "failed")
              ? "request"
              : null;
        return (
          <article
            className={classes.recordingItem}
            key={recording.roomGeneration}
          >
            <header>
              <div>
                <h5>Generation {recording.roomGeneration}</h5>
                <p>{recording.statusLabel}</p>
              </div>
              {details?.downloadAvailable ? (
                <>
                  <Button
                    component="a"
                    href={`/api/play/${encodeURIComponent(recordingId)}?occurrence=${encodeURIComponent(eventOccurrenceId)}`}
                    variant="light"
                  >
                    Play
                  </Button>
                  <Button
                    variant="light"
                    disabled={processingId !== null}
                    loading={processingId === `d${recordingId}`}
                    onClick={() => {
                      void action(`d${recordingId}`, async () => {
                        const result = await mutateEventVirtualRecording({
                          data: {
                            eventOccurrenceId,
                            recordingId,
                            action: "download",
                          },
                        });
                        if (result.status === "ready" && "url" in result)
                          window.location.assign(result.url);
                        return result;
                      });
                    }}
                  >
                    Download
                  </Button>
                </>
              ) : null}
              {deletionAction ? (
                <Button
                  variant="light"
                  disabled={processingId !== null}
                  loading={processingId === `${deletionAction}-${recordingId}`}
                  onClick={() => {
                    if (
                      deletionAction === "request" &&
                      !window.confirm("Delete recording?")
                    )
                      return;
                    void action(`${deletionAction}-${recordingId}`, () =>
                      mutateEventVirtualRecording({
                        data: {
                          eventOccurrenceId,
                          recordingId,
                          action: deletionAction,
                        },
                      }),
                    );
                  }}
                >
                  {deletionAction === "retry"
                    ? "Retry deletion"
                    : "Delete recording"}
                </Button>
              ) : null}
            </header>
            {recording.warning ? (
              <p className={classes.recordingPanel} role="status">
                {recording.warning}
              </p>
            ) : null}
            {details ? (
              <dl className={classes.recordingDetails}>
                {[
                  [
                    "Completed",
                    formatLocalDateTime(details.completedAt, {
                      timeZone: timezone,
                    }),
                  ],
                  [
                    "Duration",
                    formatRecordingDuration(details.durationNanoseconds),
                  ],
                  ["File size", formatRecordingSize(details.fileSizeBytes)],
                  [
                    "Available until",
                    formatLocalDateTime(details.retentionDeadline, {
                      timeZone: timezone,
                    }),
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

export default EventOperationsRecordingPanel;
