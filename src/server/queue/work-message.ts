import { z } from "#/validation/zod.server";

export const SCORM_INGESTION_TOPIC = "scorm.package_ingest_requested";
export const SCORM_DELETION_TOPIC = "scorm.package_delete_requested";
export const RESOURCE_DELETION_TOPIC = "resource.version_delete_requested";
export const NOTIFICATION_DELIVERY_TOPIC = "notification.delivery_requested";

const packageVersionIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const objectPathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/)
  .refine((value) => !value.includes(".."));

const scormIngestionPayloadSchema = z
  .object({
    packageVersionId: packageVersionIdSchema,
    quarantineKey: objectPathSchema,
  })
  .superRefine((payload, context) => {
    if (!payload.quarantineKey.startsWith(`scorm/${payload.packageVersionId}/`))
      context.addIssue({
        code: "custom",
        path: ["quarantineKey"],
        message: "Quarantine key must belong to the package version",
      });
  });

const scormIngestionWorkMessageSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(200),
  topic: z.literal(SCORM_INGESTION_TOPIC),
  aggregateId: z.string().min(1).max(200),
  payload: scormIngestionPayloadSchema,
});

const scormDeletionPayloadSchema = z
  .object({
    packageVersionId: packageVersionIdSchema,
    quarantinePrefix: objectPathSchema,
    contentPrefix: objectPathSchema,
  })
  .superRefine((payload, context) => {
    if (payload.quarantinePrefix !== `scorm/${payload.packageVersionId}/`)
      context.addIssue({
        code: "custom",
        path: ["quarantinePrefix"],
        message: "Quarantine prefix must match the package version",
      });
    const contentPattern = new RegExp(
      `^scorm/${payload.packageVersionId}/[a-f0-9]{64}/$`,
    );
    if (!contentPattern.test(payload.contentPrefix))
      context.addIssue({
        code: "custom",
        path: ["contentPrefix"],
        message: "Content prefix must match the immutable package version",
      });
  });

const scormDeletionWorkMessageSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(200),
  topic: z.literal(SCORM_DELETION_TOPIC),
  aggregateId: z.string().min(1).max(200),
  payload: scormDeletionPayloadSchema,
});

const resourceDeletionPayloadSchema = z
  .object({
    resourceVersionId: packageVersionIdSchema,
    objectKey: objectPathSchema,
  })
  .superRefine((payload, context) => {
    const objectPattern = new RegExp(
      `^resources/${payload.resourceVersionId}/[a-f0-9]{64}\\.pdf$`,
    );
    if (!objectPattern.test(payload.objectKey))
      context.addIssue({
        code: "custom",
        path: ["objectKey"],
        message: "Object key must match the immutable resource version",
      });
  });

const resourceDeletionWorkMessageSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(200),
  topic: z.literal(RESOURCE_DELETION_TOPIC),
  aggregateId: z.string().min(1).max(200),
  payload: resourceDeletionPayloadSchema,
});

const notificationDeliveryWorkMessageSchema = z
  .object({
    version: z.literal(1),
    eventId: z.string().min(1).max(200),
    topic: z.literal(NOTIFICATION_DELIVERY_TOPIC),
    aggregateId: z.string().min(1).max(200),
    payload: z.object({
      notificationId: packageVersionIdSchema,
    }),
  })
  .superRefine((message, context) => {
    if (message.aggregateId !== message.payload.notificationId)
      context.addIssue({
        code: "custom",
        path: ["aggregateId"],
        message: "Aggregate must match the notification",
      });
  });

const scormWorkMessageSchema = z.discriminatedUnion("topic", [
  scormIngestionWorkMessageSchema,
  scormDeletionWorkMessageSchema,
]);

const contentWorkMessageSchema = z.discriminatedUnion("topic", [
  scormIngestionWorkMessageSchema,
  scormDeletionWorkMessageSchema,
  resourceDeletionWorkMessageSchema,
]);

const workerMessageSchema = z.discriminatedUnion("topic", [
  scormIngestionWorkMessageSchema,
  scormDeletionWorkMessageSchema,
  resourceDeletionWorkMessageSchema,
  notificationDeliveryWorkMessageSchema,
]);

export type ScormIngestionWorkMessage = z.infer<
  typeof scormIngestionWorkMessageSchema
>;

export type ScormWorkMessage = z.infer<typeof scormWorkMessageSchema>;
export type ContentWorkMessage = z.infer<typeof contentWorkMessageSchema>;
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

export function parseScormIngestionWorkMessage(
  body: string,
): ScormIngestionWorkMessage {
  return scormIngestionWorkMessageSchema.parse(JSON.parse(body));
}

export function parseScormWorkMessage(body: string): ScormWorkMessage {
  return scormWorkMessageSchema.parse(JSON.parse(body));
}

export function parseContentWorkMessage(body: string): ContentWorkMessage {
  return contentWorkMessageSchema.parse(JSON.parse(body));
}

export function parseWorkerMessage(body: string): WorkerMessage {
  return workerMessageSchema.parse(JSON.parse(body));
}
