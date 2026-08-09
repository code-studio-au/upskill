import { describe, expect, it } from "vitest";
import {
  parseScormWorkMessage,
  SCORM_DELETION_TOPIC,
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

  it("parses an idempotent storage-deletion envelope", () => {
    const contentPrefix = `scorm/scorm_pkgv_1/${"0".repeat(64)}/`;
    expect(
      parseScormWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_delete_1",
          topic: SCORM_DELETION_TOPIC,
          aggregateId: "scorm_pkgv_1",
          payload: {
            packageVersionId: "scorm_pkgv_1",
            quarantinePrefix: "scorm/scorm_pkgv_1/",
            contentPrefix,
          },
        }),
      ),
    ).toEqual({
      version: 1,
      eventId: "outbox_delete_1",
      topic: SCORM_DELETION_TOPIC,
      aggregateId: "scorm_pkgv_1",
      payload: {
        packageVersionId: "scorm_pkgv_1",
        quarantinePrefix: "scorm/scorm_pkgv_1/",
        contentPrefix,
      },
    });
  });

  it("rejects deletion prefixes outside the exact package-version tree", () => {
    expect(() =>
      parseScormWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_delete_1",
          topic: SCORM_DELETION_TOPIC,
          aggregateId: "scorm_pkgv_1",
          payload: {
            packageVersionId: "scorm_pkgv_1",
            quarantinePrefix: "scorm/",
            contentPrefix: "scorm/",
          },
        }),
      ),
    ).toThrow();
  });
});
