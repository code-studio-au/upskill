import { z } from "zod";

export const SCORM_INGESTION_TOPIC = "scorm.package_ingest_requested";

export const scormIngestionPayloadSchema = z.object({
  packageVersionId: z.string().min(1).max(200),
  quarantineKey: z.string().min(1).max(1_024),
});

const scormIngestionWorkMessageSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(200),
  topic: z.literal(SCORM_INGESTION_TOPIC),
  aggregateId: z.string().min(1).max(200),
  payload: scormIngestionPayloadSchema,
});

export type ScormIngestionWorkMessage = z.infer<
  typeof scormIngestionWorkMessageSchema
>;

export function parseScormIngestionWorkMessage(
  body: string,
): ScormIngestionWorkMessage {
  return scormIngestionWorkMessageSchema.parse(JSON.parse(body));
}
