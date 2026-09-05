import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

export function eventVirtualAttendeeIdentity(
  roomId: string,
  participationId: string,
): string {
  return `attendee:${createHash("sha256")
    .update(`${roomId}:${participationId}`)
    .digest("base64url")}`;
}
