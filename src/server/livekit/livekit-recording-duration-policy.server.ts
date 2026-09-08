import "@tanstack/react-start/server-only";

export const MAXIMUM_AUTOMATIC_RECORDING_SESSION_MINUTES = 11 * 60;

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
