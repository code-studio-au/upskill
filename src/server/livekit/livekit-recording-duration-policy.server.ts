import "@tanstack/react-start/server-only";

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

export const MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES =
  (LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY.maximumLifetimeMilliseconds -
    LIVEKIT_ACCESS_GRANTS_RECORDING_AUTHORIZATION_POLICY.finalizationReserveMilliseconds) /
  MINUTE_MILLISECONDS;

export function recordingUploadAuthorizationExpiresAt(input: {
  authorizationStartsAt: Date;
  scheduledDurationMilliseconds: number;
  checkedAt: Date;
  policy: LiveKitRecordingUploadAuthorizationPolicy;
}): Date | null {
  if (input.scheduledDurationMilliseconds <= 0) return null;
  const expiresAt = new Date(
    input.authorizationStartsAt.getTime() +
      input.scheduledDurationMilliseconds +
      input.policy.finalizationReserveMilliseconds,
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
      liveKitPolicy?: { recordingMode?: string };
    }>;
  }>;
};

export function supportsAutomaticRecordingDurations(
  draft: RecordingDurationPolicyDraft,
): boolean {
  return draft.sections.every((section) =>
    section.items.every(
      (item) =>
        item.kind !== "session" ||
        item.liveKitPolicy?.recordingMode !== "automatic" ||
        (typeof item.durationMinutes === "number" &&
          item.durationMinutes <= MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES),
    ),
  );
}
