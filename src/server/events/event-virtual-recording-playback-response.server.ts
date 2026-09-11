import "@tanstack/react-start/server-only";

import { eventVirtualRecordingDownloadSchema } from "#/features/event-operations/event-operations.schema";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { boundByteRange, parseByteRange } from "#/server/http/byte-range";
import { getObjectStream } from "#/server/storage/object-storage.server";
import { accessEventVirtualRecordingPlayback } from "./event-virtual-recording-playback.server";

const MAXIMUM_PLAYBACK_RANGE_BYTES = 8 * 1024 * 1024;
const noStoreHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function objectErrorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null || !("name" in error))
    return 500;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return 404;
  if (
    error.name === "InvalidRange" ||
    error.name === "RequestedRangeNotSatisfiable"
  )
    return 416;
  return 500;
}

function limitPlaybackStreamToDeadline(
  source: ReadableStream<Uint8Array>,
  expiresAt: Date,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let timeout: ReturnType<typeof setTimeout>;
  let terminated = false;
  const clearDeadline = () => {
    clearTimeout(timeout);
  };
  const hasTerminated = () => terminated;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      reader = source.getReader();
      timeout = setTimeout(
        () => {
          if (terminated) return;
          terminated = true;
          void reader.cancel("Playback authorization expired").catch(() => {});
          controller.error(new Error("Playback authorization expired"));
        },
        Math.max(0, expiresAt.getTime() - Date.now()),
      );
      (timeout as { unref?: () => void }).unref?.();
    },
    async pull(controller) {
      if (terminated) return;
      try {
        const result = await reader.read();
        if (hasTerminated()) return;
        if (result.done) {
          terminated = true;
          clearDeadline();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        if (hasTerminated()) return;
        terminated = true;
        clearDeadline();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (terminated) return;
      terminated = true;
      clearDeadline();
      await reader.cancel(reason);
    },
  });
}

export async function handleEventVirtualRecordingPlaybackRequest(
  recordingId: string,
  request: Request,
): Promise<Response> {
  const input = eventVirtualRecordingDownloadSchema.safeParse({
    eventOccurrenceId: new URL(request.url).searchParams.get("occurrence"),
    recordingId,
  });
  if (!input.success)
    return new Response(null, { status: 404, headers: noStoreHeaders });
  const range = parseByteRange(request.headers.get("range"));
  if (range.status === "invalid")
    return new Response(null, { status: 416, headers: noStoreHeaders });
  const user = await getRequestUser();
  if (!user)
    return new Response(null, { status: 401, headers: noStoreHeaders });
  const access = await accessEventVirtualRecordingPlayback(input.data, user);
  if (access.status !== "ready") {
    const status =
      access.status === "forbidden"
        ? 403
        : access.status === "not-found"
          ? 404
          : 409;
    return new Response(null, { status, headers: noStoreHeaders });
  }
  try {
    const storageRange =
      range.status === "valid"
        ? boundByteRange(range.value, MAXIMUM_PLAYBACK_RANGE_BYTES)
        : undefined;
    const object = await getObjectStream(
      getServerEnv().S3_RECORDING_BUCKET,
      access.target.storageObjectKey,
      storageRange,
    );
    const headers = new Headers(noStoreHeaders);
    headers.set("Content-Type", "video/mp4");
    headers.set(
      "Content-Disposition",
      'inline; filename="webinar-recording.mp4"',
    );
    headers.set("Accept-Ranges", "bytes");
    if (object.contentLength !== undefined)
      headers.set("Content-Length", String(object.contentLength));
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    if (object.etag) headers.set("ETag", object.etag);
    return new Response(
      limitPlaybackStreamToDeadline(object.body, access.target.expiresAt),
      {
        status: object.contentRange ? 206 : 200,
        headers,
      },
    );
  } catch (error) {
    const status = objectErrorStatus(error);
    if (status === 500) throw error;
    return new Response(null, { status, headers: noStoreHeaders });
  }
}
