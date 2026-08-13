import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { AuditEventAction, Database } from "#/server/db/types";
import { z } from "#/validation/zod.server";

export const AUDIT_LOG_TOPIC = "audit.log_requested";

export const durableAuditActions = [
  "access_grant.administrator_capacity_updated",
  "access_grant.administrator_code_revealed",
  "access_grant.administrator_created",
  "access_grant.administrator_revoked",
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "event_occurrence.created",
  "event_occurrence.updated",
  "event_occurrence.published",
  "event_occurrence.lifecycle_changed",
  "event_occurrence.rescheduled",
  "event_attendance.recorded",
  "event_region_review.locked",
  "event_registration.administrator_added",
  "event_registration.coordinator_reviewed",
  "event_registration.final_decided",
  "event_registration.submitted",
  "event_registration.withdrawn",
  "event_template.created",
  "event_template.version_created",
  "event_template.version_published",
  "enrollment.access_code_redeemed",
  "enrollment.administrator_added",
  "enrollment.administrator_removed",
  "enrollment.learning_completed",
  "enrollment.purchased",
  "enrollment.scorm_completed",
  "order.checkout_failed",
  "order.checkout_paid",
  "order.paid_existing_enrollment",
  "resource.uploaded",
  "resource.version_removed",
  "scorm.package_uploaded",
  "scorm.package_version_removed",
  "survey.created",
  "survey.published",
  "survey.version_created",
] as const satisfies ReadonlyArray<AuditEventAction>;

export type DurableAuditAction = (typeof durableAuditActions)[number];
const projectedAuditEvents = [
  ...durableAuditActions,
  "learning.progress_overridden",
] as const;
type AuditScalar = string | number | boolean | null;
type AuditMetadata = Readonly<Record<string, AuditScalar | undefined>>;

const auditLogProjectionSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(200),
  event: z.enum(projectedAuditEvents),
  actorUserId: z.string().min(1).max(200).nullable(),
  entityType: z.string().min(1).max(80),
  entityId: z.string().min(1).max(400),
  aggregateId: z.string().min(1).max(400),
  outcome: z.literal("succeeded").optional(),
  reasonCode: z.string().min(1).max(80).optional(),
  affectedCount: z.number().int().nonnegative().optional(),
});

interface AuditLogProjection {
  eventId: string;
  event: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  aggregateId: string;
  outcome?: "succeeded";
  reasonCode?: string;
  affectedCount?: number;
}

export function parseAuditLogProjection(payload: unknown) {
  return auditLogProjectionSchema.parse(payload);
}

function definedMetadata(metadata: AuditMetadata | undefined) {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter((entry) => entry[1] !== undefined),
  );
}

export async function enqueueAuditLogProjection(
  transaction: Transaction<Database>,
  projection: AuditLogProjection,
  createdAt = new Date(),
): Promise<void> {
  await transaction
    .insertInto("outbox_event")
    .values({
      id: `outbox_${randomUUID()}`,
      topic: AUDIT_LOG_TOPIC,
      aggregateId: projection.aggregateId,
      payload: { version: 1, ...projection },
      availableAt: createdAt,
      processedAt: null,
      createdAt,
    })
    .execute();
}

export async function recordDurableAuditEvent(
  transaction: Transaction<Database>,
  input: {
    id?: string;
    actorUserId: string | null;
    action: DurableAuditAction;
    subjectType: string;
    subjectId: string;
    aggregateId?: string;
    reasonCode?: string;
    metadata?: AuditMetadata;
    createdAt?: Date;
  },
): Promise<string> {
  const id = input.id ?? `audit_${randomUUID()}`;
  const createdAt = input.createdAt ?? new Date();
  await transaction
    .insertInto("audit_event")
    .values({
      id,
      actorUserId: input.actorUserId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      reason: input.reasonCode ?? null,
      metadata: definedMetadata(input.metadata),
      createdAt,
    })
    .execute();
  await enqueueAuditLogProjection(
    transaction,
    {
      eventId: id,
      event: input.action,
      actorUserId: input.actorUserId,
      entityType: input.subjectType,
      entityId: input.subjectId,
      aggregateId: input.aggregateId ?? input.subjectId,
      outcome: "succeeded",
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    },
    createdAt,
  );
  return id;
}
