import { formatLocalDateTime } from "#/features/shared/local-date";
import { Button, Text } from "#/features/shared/mantine";
import { getEventVirtualRecordingDownload } from "#/server/functions/event-operations";
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

function recordingStatusLabel(status: Recording["status"]): string {
  return {
    requested: "Requested",
    starting: "Starting",
    active: "Recording",
    stopping: "Finalising",
    complete: "Ready",
    failed: "Failed",
    deleted: "Deleted",
  }[status];
}

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
    <section className={classes.recordingSummary} aria-label="Recordings">
      <Text fw={700}>Recordings</Text>
      {recordings.map((recording) => {
        const details = recording.details;
        const operationId = details
          ? `download-recording-${details.recordingId}`
          : null;
        return (
          <article
            className={classes.recordingItem}
            key={recording.roomGeneration}
          >
            <header>
              <div>
                <Text fw={600}>Generation {recording.roomGeneration}</Text>
                <Text c="dimmed" size="sm">
                  {recordingStatusLabel(recording.status)}
                </Text>
              </div>
              {details?.downloadAvailable ? (
                <Button
                  variant="light"
                  disabled={processingId !== null}
                  loading={processingId === operationId}
                  onClick={() => {
                    void action(
                      operationId ?? "download-recording",
                      async () => {
                        const result = await getEventVirtualRecordingDownload({
                          data: {
                            eventOccurrenceId,
                            recordingId: details.recordingId,
                          },
                        });
                        if (result.status === "ready")
                          window.location.assign(result.url);
                        return result;
                      },
                    );
                  }}
                >
                  Download recording
                </Button>
              ) : null}
            </header>
            {details ? (
              <dl className={classes.recordingDetails}>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    {formatLocalDateTime(details.completedAt, {
                      timeZone: timezone,
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>
                    {formatRecordingDuration(details.durationNanoseconds)}
                  </dd>
                </div>
                <div>
                  <dt>File size</dt>
                  <dd>{formatRecordingSize(details.fileSizeBytes)}</dd>
                </div>
                <div>
                  <dt>Available until</dt>
                  <dd>
                    {formatLocalDateTime(details.retentionDeadline, {
                      timeZone: timezone,
                    })}
                  </dd>
                </div>
              </dl>
            ) : null}
            {details && !details.downloadAvailable ? (
              <Text c="dimmed" size="sm">
                This recording is no longer available to download.
              </Text>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

export default EventOperationsRecordingPanel;
