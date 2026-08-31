export const courseCommunicationAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "active_enrollees", label: "Active enrolled learners" },
] as const;

const eventCommunicationAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "active_registrants", label: "Current registrants" },
  { value: "confirmed_participants", label: "Confirmed participants" },
  { value: "presenters", label: "Presenters" },
  { value: "coordinators", label: "Regional coordinators" },
  { value: "administrators", label: "Event administrators" },
] as const;

const affectedLearnerOnlyEventTriggers = new Set([
  "event_completed",
  "registration_cancelled",
  "registration_not_selected",
  "registration_selected",
  "registration_submitted",
  "registration_waitlisted",
  "section_release",
]);

const confirmedParticipantsOnlyEventTriggers = new Set([
  "post_event_incomplete",
  "prework_incomplete",
]);

const occurrenceLifecycleEventTriggers = new Set([
  "event_cancelled",
  "event_rescheduled",
]);

export function normalizeEventCommunicationAudience<TAudience extends string>(
  trigger: string,
  audience: TAudience,
):
  | TAudience
  | "active_registrants"
  | "affected_learner"
  | "confirmed_participants" {
  if (affectedLearnerOnlyEventTriggers.has(trigger)) return "affected_learner";
  if (confirmedParticipantsOnlyEventTriggers.has(trigger))
    return "confirmed_participants";
  if (
    occurrenceLifecycleEventTriggers.has(trigger) &&
    audience === "affected_learner"
  )
    return "active_registrants";
  if (
    !occurrenceLifecycleEventTriggers.has(trigger) &&
    audience === "active_registrants"
  )
    return "confirmed_participants";
  return audience;
}

export function eventCommunicationAudiencesForTrigger(trigger: string) {
  if (affectedLearnerOnlyEventTriggers.has(trigger))
    return eventCommunicationAudiences.filter(
      (audience) => audience.value === "affected_learner",
    );
  if (confirmedParticipantsOnlyEventTriggers.has(trigger))
    return eventCommunicationAudiences.filter(
      (audience) => audience.value === "confirmed_participants",
    );
  if (occurrenceLifecycleEventTriggers.has(trigger))
    return eventCommunicationAudiences.filter(
      (audience) => audience.value !== "affected_learner",
    );
  return eventCommunicationAudiences.filter(
    (audience) => audience.value !== "active_registrants",
  );
}

export function defaultEventCommunicationAudience(trigger: string) {
  const first = eventCommunicationAudiencesForTrigger(trigger)[0];
  if (!first) throw new Error("Event communication trigger has no audience");
  return first.value;
}

export const courseCommunicationTriggers = [
  { value: "enrollment_created", label: "Enrolment created" },
  { value: "enrollment_completed", label: "Course completed" },
  { value: "course_incomplete", label: "Course remains incomplete" },
  { value: "enrollment_expiring", label: "Enrolment expiry" },
] as const;

export const eventCommunicationTriggers = [
  { value: "registration_submitted", label: "Registration submitted" },
  { value: "registration_selected", label: "Registration confirmed" },
  { value: "registration_waitlisted", label: "Registration waitlisted" },
  { value: "registration_not_selected", label: "Registration not selected" },
  { value: "registration_cancelled", label: "Registration cancelled" },
  { value: "event_rescheduled", label: "Event rescheduled" },
  { value: "event_cancelled", label: "Event cancelled" },
  { value: "prework_incomplete", label: "Pre-work remains incomplete" },
  {
    value: "post_event_incomplete",
    label: "Post-event requirements remain incomplete",
  },
  { value: "event_start", label: "Event start" },
  { value: "event_end", label: "Event end" },
  { value: "session_start", label: "Session start" },
  { value: "section_release", label: "Section release" },
  { value: "event_completed", label: "Event completed" },
] as const;

export function formatCommunicationTiming(
  trigger: string,
  offsetAmount: number,
  offsetUnit: string,
): string {
  const triggerLabel = [
    ...courseCommunicationTriggers,
    ...eventCommunicationTriggers,
  ].find((option) => option.value === trigger)?.label;
  const anchor = (triggerLabel ?? trigger.replaceAll("_", " ")).toLowerCase();
  if (offsetAmount === 0) return `At ${anchor}`;
  const amount = Math.abs(offsetAmount);
  const unit = amount === 1 ? offsetUnit : `${offsetUnit}s`;
  return `${String(amount)} ${unit} ${offsetAmount < 0 ? "before" : "after"} ${anchor}`;
}
