import "@tanstack/react-start/server-only";

import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { parseByteRange } from "#/server/http/byte-range";
import { getObjectStream } from "#/server/storage/object-storage.server";
import { z } from "#/validation/zod";
import {
  accessEventVirtualRecordingDownload,
  isEventVirtualRecordingDownloadActive,
} from "./event-virtual-recording-download.server";
import { limitRecordingStreamToAuthorization } from "./event-virtual-recording-stream-response.server";

const noStoreHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));
const eventVirtualRecordingDownloadAccessSchema = z.object({
  eventOccurrenceId: identifier,
  recordingId: identifier,
  token: z.string().check(z.minLength(1), z.maxLength(2_048)),
});

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

export async function handleEventVirtualRecordingDownloadRequest(
  recordingId: string,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const input = eventVirtualRecordingDownloadAccessSchema.safeParse({
    eventOccurrenceId: url.searchParams.get("occurrence"),
    recordingId,
    token: url.searchParams.get("download"),
  });
  if (!input.success)
    return new Response(null, { status: 404, headers: noStoreHeaders });
  const range = parseByteRange(request.headers.get("range"));
  if (range.status === "invalid")
    return new Response(null, { status: 416, headers: noStoreHeaders });
  const user = await getRequestUser();
  if (!user)
    return new Response(null, { status: 401, headers: noStoreHeaders });
  const access = await accessEventVirtualRecordingDownload(input.data, user);
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
    const object = await getObjectStream(
      getServerEnv().S3_RECORDING_BUCKET,
      access.target.storageObjectKey,
      range.status === "valid" ? range.value : undefined,
    );
    const headers = new Headers(noStoreHeaders);
    headers.set("Content-Type", "video/mp4");
    headers.set(
      "Content-Disposition",
      'attachment; filename="webinar-recording.mp4"',
    );
    headers.set("Accept-Ranges", "bytes");
    if (object.contentLength !== undefined)
      headers.set("Content-Length", String(object.contentLength));
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    if (object.etag) headers.set("ETag", object.etag);
    return new Response(
      limitRecordingStreamToAuthorization(
        object.body,
        access.target.transferExpiresAt,
        () =>
          isEventVirtualRecordingDownloadActive(
            input.data,
            user.id,
            access.target.transferExpiresAt,
          ),
      ),
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
