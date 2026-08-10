import { describe, expect, it } from "vitest";
import {
  durableAuditActions,
  parseAuditLogProjection,
} from "./audit-event.server";

describe("audit event boundary", () => {
  it("keeps the durable action cohort intentionally small", () => {
    expect(durableAuditActions).toEqual([
      "course.archived",
      "course.created",
      "course.deleted",
      "course.published",
      "course.version_created",
      "enrollment.access_code_redeemed",
      "enrollment.learning_completed",
      "enrollment.purchased",
      "enrollment.scorm_completed",
      "order.checkout_failed",
      "order.checkout_paid",
      "order.paid_existing_enrollment",
      "resource.uploaded",
      "scorm.package_uploaded",
      "scorm.package_version_removed",
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
