import {
  eventVirtualPresenterCredentialResultSchema,
  type EventVirtualPresenterCredentialResult,
} from "./event-operations.schema";
import { getEventVirtualPresenterCredential } from "#/server/functions/event-operations";
import { isLiveKitPresenterMediaSupported } from "./livekit-presenter-media";

interface PresenterJoinDependencies {
  isBrowserSupported: () => Promise<boolean>;
  requestCredential: () => Promise<unknown>;
}

const MINIMUM_PRESENTER_JOIN_WINDOW_MS = 5_000;

export function presenterCredentialCanStartConnection(
  expiresAt: string,
  now = Date.now(),
): boolean {
  const expiry = Date.parse(expiresAt);
  return (
    Number.isFinite(expiry) && expiry - now > MINIMUM_PRESENTER_JOIN_WINDOW_MS
  );
}

export type PresenterJoinPreparationResult =
  | { status: "unsupported" }
  | {
      status: "credential-result";
      result: EventVirtualPresenterCredentialResult;
    };

export async function prepareLiveKitPresenterJoin(
  input: { eventOccurrenceId: string; eventSessionId: string },
  dependencies: PresenterJoinDependencies = {
    isBrowserSupported: isLiveKitPresenterMediaSupported,
    requestCredential: () =>
      getEventVirtualPresenterCredential({ data: input }),
  },
): Promise<PresenterJoinPreparationResult> {
  if (!(await dependencies.isBrowserSupported()))
    return { status: "unsupported" };
  const result = eventVirtualPresenterCredentialResultSchema.parse(
    await dependencies.requestCredential(),
  );
  return { status: "credential-result", result };
}
