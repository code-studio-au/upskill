import type { AttendeeMediaDisconnectReason } from "./livekit-attendee-media";
import type { EventVirtualAttendeeCredentialResult } from "./event-virtual-lobby.schema";

export type AttendeeTerminalConnectionPhase =
  "disconnected" | "duplicate" | "removed" | "ended";

const MINIMUM_JOIN_WINDOW_MS = 5_000;

export function attendeeCredentialDisposition(
  result: EventVirtualAttendeeCredentialResult,
): "connect" | "reload-lobby" | "retry" {
  if (result.status === "ready") return "connect";
  if (
    result.status === "conflict" &&
    ["capacity_reached", "provider_unavailable"].includes(result.reason)
  )
    return "retry";
  return "reload-lobby";
}

export function attendeeCredentialCanStartConnection(
  expiresAt: string,
  now = Date.now(),
): boolean {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry - now > MINIMUM_JOIN_WINDOW_MS;
}

export function attendeeTerminalConnectionPhase(
  reason: AttendeeMediaDisconnectReason,
): AttendeeTerminalConnectionPhase {
  if (reason === "duplicate_identity") return "duplicate";
  if (reason === "participant_removed") return "removed";
  if (reason === "room_ended") return "ended";
  return "disconnected";
}

export function shouldReloadLobbyAfterDisconnect(
  phase: AttendeeTerminalConnectionPhase,
): boolean {
  return phase === "removed" || phase === "ended";
}
