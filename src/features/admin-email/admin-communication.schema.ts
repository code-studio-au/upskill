import type { EmailTemplateVariableGroup } from "./admin-email.schema";
import { eventCommunicationAudiencesForTrigger } from "./communication-options";
import { z } from "#/validation/zod";

const id = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));
const optionalId = z.nullable(id);
const label = z.string().check(z.trim(), z.minLength(2), z.maxLength(120));
const subject = z
  .string()
  .check(z.trim(), z.minLength(1), z.maxLength(180), z.regex(/^[^\r\n]+$/u));
const body = z.string().check(z.trim(), z.minLength(1), z.maxLength(20_000));

export const communicationScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("course"), courseVersionId: id }),
  z.object({ kind: z.literal("event_template"), eventTemplateVersionId: id }),
  z.object({ kind: z.literal("event_occurrence"), eventOccurrenceId: id }),
]);
export type CommunicationScope = z.infer<typeof communicationScopeSchema>;

const courseCommunicationAudienceSchema = z.enum([
  "affected_learner",
  "active_enrollees",
]);
const eventCommunicationAudienceSchema = z.enum([
  "affected_learner",
  "active_registrants",
  "confirmed_participants",
  "presenters",
  "coordinators",
  "administrators",
]);
const courseCommunicationTriggerSchema = z.enum([
  "enrollment_created",
  "enrollment_completed",
  "course_incomplete",
  "enrollment_expiring",
]);
const eventCommunicationTriggerSchema = z.enum([
  "registration_submitted",
  "registration_selected",
  "registration_waitlisted",
  "registration_not_selected",
  "registration_cancelled",
  "event_rescheduled",
  "event_cancelled",
  "prework_incomplete",
  "event_start",
  "event_end",
  "session_start",
  "section_release",
  "event_completed",
]);
const communicationOffsetUnitSchema = z.enum(["minute", "hour", "day", "week"]);

const scheduleEmailFields = {
  id,
  kind: z.literal("automated_email"),
  title: label,
  emailDesignVersionId: id,
  offsetAmount: z
    .number()
    .check(z.int(), z.minimum(-10_000), z.maximum(10_000)),
  offsetUnit: communicationOffsetUnitSchema,
  subjectOverride: z.nullable(subject),
  textBodyOverride: z.nullable(body),
};

export const courseScheduleEmailItemSchema = z.object({
  ...scheduleEmailFields,
  audience: courseCommunicationAudienceSchema,
  trigger: courseCommunicationTriggerSchema,
});

export const eventScheduleEmailItemSchema = z
  .object({
    ...scheduleEmailFields,
    audience: eventCommunicationAudienceSchema,
    trigger: eventCommunicationTriggerSchema,
    sessionItemId: optionalId,
  })
  .check(
    z.superRefine((item, context) => {
      if (
        !eventCommunicationAudiencesForTrigger(item.trigger).some(
          (audience) => audience.value === item.audience,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["audience"],
          message: "The selected audience is not valid for this trigger.",
        });
    }),
  );

export type CourseScheduleEmailItem = z.infer<
  typeof courseScheduleEmailItemSchema
>;
export type EventScheduleEmailItem = z.infer<
  typeof eventScheduleEmailItemSchema
>;

const overrideOccurrenceCommunicationSchema = z.object({
  eventOccurrenceId: id,
  logicalId: id,
  subject,
  textBody: body,
  offsetAmount: z
    .number()
    .check(z.int(), z.minimum(-10_000), z.maximum(10_000)),
  offsetUnit: communicationOffsetUnitSchema,
});

const resetOccurrenceCommunicationSchema = z.object({
  eventOccurrenceId: id,
  logicalId: id,
});

export const adminCommunicationMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("override_occurrence"),
    payload: overrideOccurrenceCommunicationSchema,
  }),
  z.object({
    action: z.literal("reset_occurrence"),
    payload: resetOccurrenceCommunicationSchema,
  }),
]);

export const previewCommunicationSchema = z.object({
  scope: communicationScopeSchema,
  communicationId: z.optional(id),
  emailDesignVersionId: z.optional(id),
  subject: z.optional(subject),
  textBody: z.optional(body),
  offeringTitle: z.optional(label),
  sectionTitle: z.optional(label),
  sessionTitle: z.optional(label),
});

export interface AdminCommunicationTemplateOption {
  versionId: string;
  designName: string;
  version: number;
  subject: string;
  textBody: string;
  selectable?: boolean;
}

export interface AdminCommunicationPlanItem {
  id: string;
  logicalId: string;
  revision: number | null;
  overrideState: "inherited" | "overridden" | "template";
  label: string;
  emailDesignVersionId: string;
  emailDesignName: string;
  emailDesignVersion: number;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  position: number;
  audience: string;
  trigger: string;
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subject: string;
  textBody: string;
  subjectOverridden: boolean;
  textBodyOverridden: boolean;
}

export interface AdminCommunicationWorkspace {
  scope: CommunicationScope & {
    title: string;
    version: number | null;
    editable: boolean;
  };
  sections: Array<{ id: string; title: string }>;
  sessions: Array<{ id: string; title: string }>;
  templates: Array<AdminCommunicationTemplateOption>;
  variableGroups: Array<EmailTemplateVariableGroup>;
  items: Array<AdminCommunicationPlanItem>;
}

export type AdminCommunicationResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "conflict"; reason: string };
