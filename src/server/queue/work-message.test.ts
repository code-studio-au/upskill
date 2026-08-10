import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_GENERATION_TOPIC,
  parseContentWorkMessage,
  parseScormWorkMessage,
  RESOURCE_DELETION_TOPIC,
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

  it("accepts only the exact immutable PDF object for resource cleanup", () => {
    const resourceVersionId = "resource_version_1";
    const objectKey = `resources/${resourceVersionId}/${"a".repeat(64)}.pdf`;
    expect(
      parseContentWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_resource_delete_1",
          topic: RESOURCE_DELETION_TOPIC,
          aggregateId: resourceVersionId,
          payload: { resourceVersionId, objectKey },
        }),
      ),
    ).toMatchObject({ topic: RESOURCE_DELETION_TOPIC, payload: { objectKey } });

    expect(() =>
      parseContentWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_resource_delete_2",
          topic: RESOURCE_DELETION_TOPIC,
          aggregateId: resourceVersionId,
          payload: { resourceVersionId, objectKey: "resources/other/file.pdf" },
        }),
      ),
    ).toThrow();
  });

  it("accepts only the certificate's exact private PDF object", () => {
    const certificateId = "certificate_1";
    expect(
      parseContentWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_certificate_1",
          topic: CERTIFICATE_GENERATION_TOPIC,
          aggregateId: certificateId,
          payload: {
            certificateId,
            objectKey: `certificates/${certificateId}.pdf`,
          },
        }),
      ),
    ).toMatchObject({
      topic: CERTIFICATE_GENERATION_TOPIC,
      payload: { certificateId },
    });

    expect(() =>
      parseContentWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: "outbox_certificate_2",
          topic: CERTIFICATE_GENERATION_TOPIC,
          aggregateId: certificateId,
          payload: {
            certificateId,
            objectKey: "certificates/other.pdf",
          },
        }),
      ),
    ).toThrow();
  });
});
