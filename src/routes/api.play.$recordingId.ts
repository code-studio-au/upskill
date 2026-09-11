import { createFileRoute } from "@tanstack/react-router";
import { handleEventVirtualRecordingPlaybackRequest } from "#/server/events/event-virtual-recording-playback-response.server";

export const Route = createFileRoute("/api/play/$recordingId")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        handleEventVirtualRecordingPlaybackRequest(params.recordingId, request),
    },
  },
});
