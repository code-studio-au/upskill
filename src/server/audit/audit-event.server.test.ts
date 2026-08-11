import { describe, expect, it } from "vitest";
import {
  durableAuditActions,
  parseAuditLogProjection,
} from "./audit-event.server";

describe("audit event boundary", () => {
  it("keeps the durable action cohort intentionally small", () => {
    expect(durableAuditActions).toEqual([
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
      "event_registration.submitted",
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
    ]);
  });

  it("accepts only versioned, known, scalar audit projections", () => {
    expect(
      parseAuditLogProjection({
        version: 1,
        eventId: "audit_1",
        event: "order.checkout_paid",
        actorUserId: "user_1",
        entityType: "order",
        entityId: "order_1",
        aggregateId: "order_1",
        outcome: "succeeded",
      }),
    ).toMatchObject({ eventId: "audit_1", event: "order.checkout_paid" });

    expect(() =>
      parseAuditLogProjection({
        version: 1,
        eventId: "audit_2",
        event: "unknown.event",
        actorUserId: null,
        entityType: "order",
        entityId: "order_2",
        aggregateId: "order_2",
      }),
    ).toThrow();
  });
});
