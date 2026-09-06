import {
  eventVirtualAttendeeCredentialResultSchema,
  type EventVirtualAttendeeCredentialResult,
} from "./event-virtual-lobby.schema";
import { isLiveKitAttendeeMediaSupported } from "./livekit-attendee-media";

type AttendeeCredentialRequester = (
  publicReference: string,
  signal: AbortSignal,
) => Promise<EventVirtualAttendeeCredentialResult>;

interface AttendeeJoinPreflightDependencies {
  isBrowserSupported: () => Promise<boolean>;
  requestCredential: AttendeeCredentialRequester;
}

export type AttendeeJoinPreflightResult =
  | { status: "unsupported" }
  | {
      status: "credential-result";
      result: EventVirtualAttendeeCredentialResult;
    };

async function requestCredential(
  publicReference: string,
  signal: AbortSignal,
): Promise<EventVirtualAttendeeCredentialResult> {
  const body = new FormData();
  body.set("intent", "credential");
  const response = await fetch(
    `/webinars/${encodeURIComponent(publicReference)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      body,
      signal,
    },
  );
  if (!response.ok) {
    if (![401, 404, 409].includes(response.status))
      throw new Error("Unexpected attendee credential response");
    const payload: unknown = await response.json();
    const parsed =
      eventVirtualAttendeeCredentialResultSchema.safeParse(payload);
    if (
      !parsed.success ||
      parsed.data.status === "ready" ||
      (parsed.data.status === "unauthenticated" && response.status !== 401) ||
      (parsed.data.status === "not-found" && response.status !== 404) ||
      (parsed.data.status === "conflict" && response.status !== 409)
    )
      throw new Error("Invalid attendee credential response");
    return parsed.data;
  }
  const payload: unknown = await response.json();
  const parsed = eventVirtualAttendeeCredentialResultSchema.safeParse(payload);
  if (!parsed.success || parsed.data.status !== "ready")
    throw new Error("Invalid attendee credential response");
  return parsed.data;
}

const defaultDependencies: AttendeeJoinPreflightDependencies = {
  isBrowserSupported: isLiveKitAttendeeMediaSupported,
  requestCredential,
};

export async function prepareLiveKitAttendeeJoin(
  publicReference: string,
  signal: AbortSignal,
  dependencies: AttendeeJoinPreflightDependencies = defaultDependencies,
): Promise<AttendeeJoinPreflightResult> {
  if (!(await dependencies.isBrowserSupported()))
    return { status: "unsupported" };
  return {
    status: "credential-result",
    result: await dependencies.requestCredential(publicReference, signal),
  };
}
