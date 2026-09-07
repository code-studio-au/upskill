import {
  eventVirtualPresenterCredentialResultSchema,
  type EventVirtualPresenterCredentialResult,
} from "./event-operations.schema";
import { getEventVirtualPresenterCredential } from "#/server/functions/event-operations";
import {
  createLiveKitPresenterMediaSession,
  type PresenterMediaSession,
  type PresenterMediaSessionResult,
} from "./livekit-presenter-media";

interface PresenterJoinDependencies {
  createMediaSession: () => Promise<PresenterMediaSessionResult>;
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
      session: PresenterMediaSession;
    };

export async function prepareLiveKitPresenterJoin(
  input: { eventOccurrenceId: string; eventSessionId: string },
  dependencies: PresenterJoinDependencies = {
    createMediaSession: createLiveKitPresenterMediaSession,
    requestCredential: () =>
      getEventVirtualPresenterCredential({ data: input }),
  },
): Promise<PresenterJoinPreparationResult> {
  const media = await dependencies.createMediaSession();
  if (media.status === "unsupported") return media;
  try {
    const result = eventVirtualPresenterCredentialResultSchema.parse(
      await dependencies.requestCredential(),
    );
    return { status: "credential-result", result, session: media.session };
  } catch (error) {
    await media.session.dispose();
    throw error;
  }
}
