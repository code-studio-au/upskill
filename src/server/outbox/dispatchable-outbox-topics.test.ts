import { describe, expect, it } from "vitest";
import dispatchableOutboxTopics from "../../../config/dispatchable-outbox-topics.json" with { type: "json" };
import { AUDIT_LOG_TOPIC } from "#/server/audit/audit-event.server";
import {
  NOTIFICATION_DELIVERY_TOPIC,
  RESOURCE_DELETION_TOPIC,
  SCORM_DELETION_TOPIC,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";

describe("dispatchable outbox topics", () => {
  it("keeps worker dispatch and operational metrics scoped to work topics", () => {
    expect(dispatchableOutboxTopics).toEqual([
      AUDIT_LOG_TOPIC,
      RESOURCE_DELETION_TOPIC,
      SCORM_INGESTION_TOPIC,
      SCORM_DELETION_TOPIC,
      NOTIFICATION_DELIVERY_TOPIC,
    ]);
    expect(dispatchableOutboxTopics).not.toContain("enrollment.created");
    expect(dispatchableOutboxTopics).not.toContain("order.bulk_fulfilled");
  });
});
