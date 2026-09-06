import { z } from "#/validation/zod";
import { eventVirtualLobbyReferenceSchema } from "./event-virtual-lobby.schema";

export const eventVirtualRecoveryRequestSchema = z.object({
  publicReference: eventVirtualLobbyReferenceSchema.shape.publicReference,
  identifier: z.string().check(z.trim(), z.minLength(3), z.maxLength(255)),
});

export const eventVirtualRecoveryVerificationSchema = z.object({
  publicReference: eventVirtualLobbyReferenceSchema.shape.publicReference,
  challengeReference: z
    .string()
    .check(z.length(32), z.regex(/^[A-Za-z0-9_-]+$/u)),
  code: z.string().check(z.regex(/^\d{6}$/u)),
});
