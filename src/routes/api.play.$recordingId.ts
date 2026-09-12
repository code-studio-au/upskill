import { createFileRoute } from "@tanstack/react-router";
import { handleEventVirtualRecordingDownloadRequest } from "#/server/events/event-virtual-recording-download-response.server";
import { handleEventVirtualRecordingPlaybackRequest } from "#/server/events/event-virtual-recording-playback-response.server";

export const Route = createFileRoute("/api/play/$recordingId")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        new URL(request.url).searchParams.has("download")
          ? handleEventVirtualRecordingDownloadRequest(
              params.recordingId,
              request,
            )
          : handleEventVirtualRecordingPlaybackRequest(
              params.recordingId,
              request,
            ),
    },
  },
});
