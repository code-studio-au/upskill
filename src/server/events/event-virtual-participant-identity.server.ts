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

export function isEventVirtualAttendeeIdentity(identity: string): boolean {
  return /^attendee:[A-Za-z0-9_-]{43}$/.test(identity);
}

export function eventVirtualPresenterIdentity(
  roomId: string,
  userId: string,
): string {
  return `staff_${createHash("sha256")
    .update(`${roomId}:${userId}`)
    .digest("hex")}`;
}
