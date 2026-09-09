import "@tanstack/react-start/server-only";

import type { ServerEnv } from "#/server/env.server";

const MINUTE_MILLISECONDS = 60 * 1_000;

export interface LiveKitRecordingUploadAuthorizationPolicy {
  maximumLifetimeMilliseconds: number;
  finalizationReserveMilliseconds: number;
}

export const LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY = {
  maximumLifetimeMilliseconds: 60 * MINUTE_MILLISECONDS,
  finalizationReserveMilliseconds: 5 * MINUTE_MILLISECONDS,
} as const satisfies LiveKitRecordingUploadAuthorizationPolicy;

export const LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY = {
  maximumLifetimeMilliseconds: 12 * 60 * MINUTE_MILLISECONDS,
  finalizationReserveMilliseconds: 60 * MINUTE_MILLISECONDS,
} as const satisfies LiveKitRecordingUploadAuthorizationPolicy;

export function usesRoleChainedRecordingUploadAuthorization(
  appEnvironment: ServerEnv["APP_ENV"],
): boolean {
  return appEnvironment === "development" || appEnvironment === "test";
}

export function recordingUploadAuthorizationPolicyForEnvironment(
  appEnvironment: ServerEnv["APP_ENV"],
): LiveKitRecordingUploadAuthorizationPolicy {
  return usesRoleChainedRecordingUploadAuthorization(appEnvironment)
    ? LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY
    : LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY;
}

export function maximumAutomaticRecordingWindowMinutes(
  policy: LiveKitRecordingUploadAuthorizationPolicy,
): number {
  return (
    (policy.maximumLifetimeMilliseconds -
      policy.finalizationReserveMilliseconds) /
    MINUTE_MILLISECONDS
  );
}

export function supportsAutomaticRecordingSessionWindow(
  durationMilliseconds: number,
  presenterPreparationMilliseconds: number,
  policy: LiveKitRecordingUploadAuthorizationPolicy,
): boolean {
  return (
    durationMilliseconds > 0 &&
    presenterPreparationMilliseconds >= 0 &&
    durationMilliseconds + presenterPreparationMilliseconds <=
      policy.maximumLifetimeMilliseconds -
        policy.finalizationReserveMilliseconds
  );
}

export function recordingUploadAuthorizationExpiresAt(input: {
  authorizationStartsAt: Date;
  scheduledDurationMilliseconds: number;
  scheduledEndsAt: Date;
  checkedAt: Date;
  policy: LiveKitRecordingUploadAuthorizationPolicy;
}): Date | null {
  if (input.scheduledDurationMilliseconds <= 0) return null;
  const actualDurationExpiresAt =
    input.authorizationStartsAt.getTime() +
    input.scheduledDurationMilliseconds +
    input.policy.finalizationReserveMilliseconds;
  const scheduledCoverageExpiresAt =
    input.scheduledEndsAt.getTime() +
    input.policy.finalizationReserveMilliseconds;
  const expiresAt = new Date(
    Math.max(actualDurationExpiresAt, scheduledCoverageExpiresAt),
  );
  const requiredLifetimeMilliseconds =
    expiresAt.getTime() - input.checkedAt.getTime();
  return requiredLifetimeMilliseconds > 0 &&
    requiredLifetimeMilliseconds <= input.policy.maximumLifetimeMilliseconds
    ? expiresAt
    : null;
}

type RecordingDurationPolicyDraft = {
  sections: Array<{
    items: Array<{
      kind: string;
      durationMinutes?: number | null;
      liveKitPolicy?: {
        recordingMode?: string;
        presenterPreparationMinutes?: number;
      };
    }>;
  }>;
};

export function supportsAutomaticRecordingDurations(
  draft: RecordingDurationPolicyDraft,
  policy: LiveKitRecordingUploadAuthorizationPolicy,
): boolean {
  return draft.sections.every((section) =>
    section.items.every(
      (item) =>
        item.kind !== "session" ||
        item.liveKitPolicy?.recordingMode !== "automatic" ||
        (typeof item.durationMinutes === "number" &&
          typeof item.liveKitPolicy.presenterPreparationMinutes === "number" &&
          supportsAutomaticRecordingSessionWindow(
            item.durationMinutes * MINUTE_MILLISECONDS,
            item.liveKitPolicy.presenterPreparationMinutes *
              MINUTE_MILLISECONDS,
            policy,
          )),
    ),
  );
}
