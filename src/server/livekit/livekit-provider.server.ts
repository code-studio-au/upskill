import "@tanstack/react-start/server-only";

import {
  AccessToken,
  LiveKitAPI,
  ServerError,
  TrackSource,
  type ParticipantInfo,
  type Room,
} from "livekit-server-sdk";
import { sql } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv, type ServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";

export const LIVEKIT_JOIN_TOKEN_TTL_SECONDS = 5 * 60;

const opaqueNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/u);
const displayNameSchema = z.string().trim().min(1).max(200);
const roomMetadataSchema = z.string().max(4_096);

const ensureRoomInputSchema = z.object({
  roomName: opaqueNameSchema,
  maxParticipants: z.number().int().min(2).max(10_000),
  emptyTimeoutSeconds: z.number().int().min(60).max(86_400),
  departureTimeoutSeconds: z.number().int().min(0).max(3_600),
  metadata: roomMetadataSchema.optional(),
});
type ParsedEnsureLiveKitRoomInput = z.infer<typeof ensureRoomInputSchema>;

const joinTokenInputSchema = z.object({
  roomName: opaqueNameSchema,
  participantIdentity: opaqueNameSchema,
  displayName: displayNameSchema,
  role: z.enum(["attendee", "presenter"]),
});

const participantTargetSchema = z.object({
  roomName: opaqueNameSchema,
  participantIdentity: opaqueNameSchema,
});

type LiveKitParticipantRole = "attendee" | "presenter";

export interface EnsureLiveKitRoomInput {
  roomName: string;
  maxParticipants: number;
  emptyTimeoutSeconds: number;
  departureTimeoutSeconds: number;
  metadata?: string;
}

export interface LiveKitRoomSnapshot {
  sid: string;
  name: string;
  maxParticipants: number;
}

export interface LiveKitParticipantSnapshot {
  sid: string;
  identity: string;
  displayName: string;
}

export interface CreateLiveKitJoinTokenInput {
  roomName: string;
  participantIdentity: string;
  displayName: string;
  role: LiveKitParticipantRole;
}

export interface LiveKitJoinCredential {
  token: string;
  expiresAt: Date;
}

export interface LiveKitProvider {
  checkHealth(): Promise<void>;
  ensureRoom(input: EnsureLiveKitRoomInput): Promise<LiveKitRoomSnapshot>;
  listParticipants(roomName: string): Promise<LiveKitParticipantSnapshot[]>;
  removeParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<void>;
  closeRoom(roomName: string): Promise<void>;
  createJoinToken(
    input: CreateLiveKitJoinTokenInput,
  ): Promise<LiveKitJoinCredential>;
}

export type LiveKitRoomCreationCoordinator = <Result>(
  operation: () => Promise<Result>,
) => Promise<Result>;

export class LiveKitProviderError extends Error {
  readonly code = "LIVEKIT_PROVIDER_OPERATION_FAILED";

  constructor(readonly operation: string) {
    super(`LiveKit provider operation failed: ${operation}`);
    this.name = "LiveKitProviderError";
  }
}

interface LiveKitRoomClient {
  createRoom(input: {
    name: string;
    maxParticipants?: number;
    emptyTimeout?: number;
    departureTimeout?: number;
    metadata?: string;
  }): Promise<Room>;
  listRooms(names?: string[]): Promise<Room[]>;
  listParticipants(roomName: string): Promise<ParticipantInfo[]>;
  removeParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<void>;
  deleteRoom(roomName: string): Promise<void>;
}

interface LiveKitApiClient {
  room: LiveKitRoomClient;
}

export async function coordinateLiveKitRoomCreation<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(
          hashtextextended('upskill.livekit.room-creation.v1', 0)
        )`.execute(transaction);
      return await operation();
    });
}

export interface EnabledLiveKitConfiguration {
  url: string;
  apiKey: string;
  apiSecret: string;
  approvedMaxParticipants: number;
  approvedMaxConcurrentRooms: number;
}

function roomSnapshot(room: Room): LiveKitRoomSnapshot {
  return {
    sid: room.sid,
    name: room.name,
    maxParticipants: room.maxParticipants,
  };
}

function reconciledRoomSnapshot(
  room: Room,
  expected: ParsedEnsureLiveKitRoomInput,
): LiveKitRoomSnapshot {
  if (
    room.name !== expected.roomName ||
    room.maxParticipants !== expected.maxParticipants ||
    room.emptyTimeout !== expected.emptyTimeoutSeconds ||
    room.departureTimeout !== expected.departureTimeoutSeconds ||
    room.metadata !== (expected.metadata ?? "")
  )
    throw new LiveKitProviderError("reconcile_room");
  return roomSnapshot(room);
}

function isLiveKitNotFound(error: unknown): boolean {
  return (
    error instanceof ServerError &&
    (error.status === 404 || error.code === "not_found")
  );
}

function participantSnapshot(
  participant: ParticipantInfo,
): LiveKitParticipantSnapshot {
  return {
    sid: participant.sid,
    identity: participant.identity,
    displayName: participant.name,
  };
}

export function getEnabledLiveKitConfiguration(
  environment: ServerEnv = getServerEnv(),
): EnabledLiveKitConfiguration | null {
  if (!environment.LIVEKIT_ENABLED) return null;
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
    LIVEKIT_APPROVED_MAX_PARTICIPANTS: approvedMaxParticipants,
    LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: approvedMaxConcurrentRooms,
  } = environment;
  if (
    !url ||
    !apiKey ||
    !apiSecret ||
    !approvedMaxParticipants ||
    !approvedMaxConcurrentRooms
  )
    throw new Error("Enabled LiveKit configuration is incomplete");
  return {
    url,
    apiKey,
    apiSecret,
    approvedMaxParticipants,
    approvedMaxConcurrentRooms,
  };
}

export class LiveKitCloudProvider implements LiveKitProvider {
  private readonly api: LiveKitApiClient;

  constructor(
    private readonly configuration: EnabledLiveKitConfiguration,
    api?: LiveKitApiClient,
    private readonly coordinateRoomCreation: LiveKitRoomCreationCoordinator = coordinateLiveKitRoomCreation,
  ) {
    this.api =
      api ??
      new LiveKitAPI({
        host: configuration.url,
        apiKey: configuration.apiKey,
        secret: configuration.apiSecret,
      });
  }

  async checkHealth(): Promise<void> {
    try {
      await this.api.room.listRooms([]);
    } catch {
      throw new LiveKitProviderError("health");
    }
  }

  async ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    const parsed = ensureRoomInputSchema.parse(input);
    if (parsed.maxParticipants > this.configuration.approvedMaxParticipants)
      throw new RangeError(
        "LiveKit room capacity exceeds the approved environment limit",
      );
    try {
      return await this.coordinateRoomCreation(async () => {
        const [existing] = await this.api.room.listRooms([parsed.roomName]);
        if (existing) return reconciledRoomSnapshot(existing, parsed);
        const activeRooms = await this.api.room.listRooms();
        if (activeRooms.length >= this.configuration.approvedMaxConcurrentRooms)
          throw new RangeError(
            "LiveKit room creation exceeds the approved concurrent-room limit",
          );
        try {
          return reconciledRoomSnapshot(
            await this.api.room.createRoom({
              name: parsed.roomName,
              maxParticipants: parsed.maxParticipants,
              emptyTimeout: parsed.emptyTimeoutSeconds,
              departureTimeout: parsed.departureTimeoutSeconds,
              ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
            }),
            parsed,
          );
        } catch (error) {
          if (error instanceof LiveKitProviderError) throw error;
          const [concurrentlyCreated] = await this.api.room.listRooms([
            parsed.roomName,
          ]);
          if (concurrentlyCreated)
            return reconciledRoomSnapshot(concurrentlyCreated, parsed);
          throw new LiveKitProviderError("ensure_room");
        }
      });
    } catch (error) {
      if (error instanceof LiveKitProviderError || error instanceof RangeError)
        throw error;
      throw new LiveKitProviderError("ensure_room");
    }
  }

  async listParticipants(
    roomName: string,
  ): Promise<LiveKitParticipantSnapshot[]> {
    const parsedRoomName = opaqueNameSchema.parse(roomName);
    try {
      return (await this.api.room.listParticipants(parsedRoomName)).map(
        participantSnapshot,
      );
    } catch {
      throw new LiveKitProviderError("list_participants");
    }
  }

  async removeParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<void> {
    const parsed = participantTargetSchema.parse({
      roomName,
      participantIdentity,
    });
    try {
      await this.api.room.removeParticipant(
        parsed.roomName,
        parsed.participantIdentity,
      );
    } catch {
      try {
        const participants = await this.api.room.listParticipants(
          parsed.roomName,
        );
        if (
          !participants.some(
            (participant) =>
              participant.identity === parsed.participantIdentity,
          )
        )
          return;
      } catch (reconciliationError) {
        if (isLiveKitNotFound(reconciliationError)) return;
      }
      throw new LiveKitProviderError("remove_participant");
    }
  }

  async closeRoom(roomName: string): Promise<void> {
    const parsedRoomName = opaqueNameSchema.parse(roomName);
    try {
      await this.api.room.deleteRoom(parsedRoomName);
    } catch {
      try {
        const rooms = await this.api.room.listRooms([parsedRoomName]);
        if (!rooms.some((room) => room.name === parsedRoomName)) return;
      } catch {
        // Preserve the safe provider failure below when reconciliation fails.
      }
      throw new LiveKitProviderError("close_room");
    }
  }

  async createJoinToken(
    input: CreateLiveKitJoinTokenInput,
  ): Promise<LiveKitJoinCredential> {
    const parsed = joinTokenInputSchema.parse(input);
    const token = new AccessToken(
      this.configuration.apiKey,
      this.configuration.apiSecret,
      {
        identity: parsed.participantIdentity,
        name: parsed.displayName,
        ttl: LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
        metadata: JSON.stringify({ role: parsed.role }),
      },
    );
    token.addGrant({
      roomJoin: true,
      room: parsed.roomName,
      roomAdmin: false,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      ...(parsed.role === "presenter"
        ? {
            canPublish: true,
            canPublishSources: [
              TrackSource.CAMERA,
              TrackSource.MICROPHONE,
              TrackSource.SCREEN_SHARE,
              TrackSource.SCREEN_SHARE_AUDIO,
            ],
          }
        : { canPublish: false }),
    });
    try {
      const serializedToken = await token.toJwt();
      const encodedPayload = serializedToken.split(".")[1];
      if (!encodedPayload) throw new Error("missing token payload");
      const claims = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as { exp?: unknown };
      if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp))
        throw new Error("missing token expiry");
      return {
        token: serializedToken,
        expiresAt: new Date(claims.exp * 1_000),
      };
    } catch {
      throw new LiveKitProviderError("create_join_token");
    }
  }
}

export function createConfiguredLiveKitProvider(
  environment: ServerEnv = getServerEnv(),
): LiveKitProvider | null {
  const configuration = getEnabledLiveKitConfiguration(environment);
  return configuration ? new LiveKitCloudProvider(configuration) : null;
}
