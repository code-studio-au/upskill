import { describe, expect, it } from "vitest";
import {
  parseScormIngestionWorkMessage,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";

describe("SCORM ingestion work messages", () => {
  it("parses the versioned transport envelope", () => {
    expect(
      parseScormIngestionWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_1",
          topic: SCORM_INGESTION_TOPIC,
          aggregateId: "scorm_pkgv_1",
          payload: {
            packageVersionId: "scorm_pkgv_1",
            quarantineKey: "scorm/scorm_pkgv_1/archive.zip",
          },
        }),
      ),
    ).toEqual({
      version: 1,
      eventId: "outbox_1",
      topic: SCORM_INGESTION_TOPIC,
      aggregateId: "scorm_pkgv_1",
      payload: {
        packageVersionId: "scorm_pkgv_1",
        quarantineKey: "scorm/scorm_pkgv_1/archive.zip",
      },
    });
  });

  it("rejects unknown versions and topics", () => {
    expect(() =>
      parseScormIngestionWorkMessage(
        JSON.stringify({
          version: 2,
          eventId: "outbox_1",
          topic: "unknown.topic",
          aggregateId: "scorm_pkgv_1",
          payload: {},
        }),
      ),
    ).toThrow();
  });
});
