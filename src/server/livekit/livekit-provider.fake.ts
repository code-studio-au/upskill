import "@tanstack/react-start/server-only";

import type {
  CreateLiveKitJoinTokenInput,
  EnsureLiveKitRoomInput,
  LiveKitParticipantSnapshot,
  LiveKitProvider,
  LiveKitJoinCredential,
  LiveKitRoomSnapshot,
} from "./livekit-provider.server";
import {
  LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
  LiveKitProviderError,
} from "./livekit-provider.server";

export type FakeLiveKitOperation =
  | { operation: "health" }
  | { operation: "ensure_room"; input: EnsureLiveKitRoomInput }
  | { operation: "list_participants"; roomName: string }
  | {
      operation: "remove_participant";
      roomName: string;
      participantIdentity: string;
    }
  | { operation: "close_room"; roomName: string }
  | { operation: "create_join_token"; input: CreateLiveKitJoinTokenInput };

export class FakeLiveKitProvider implements LiveKitProvider {
  readonly operations: FakeLiveKitOperation[] = [];
  readonly rooms = new Map<string, LiveKitRoomSnapshot>();
  readonly participants = new Map<string, LiveKitParticipantSnapshot[]>();
  private readonly roomConfigurations = new Map<
    string,
    EnsureLiveKitRoomInput
  >();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  checkHealth(): Promise<void> {
    this.operations.push({ operation: "health" });
    return Promise.resolve();
  }

  ensureRoom(input: EnsureLiveKitRoomInput): Promise<LiveKitRoomSnapshot> {
    this.operations.push({ operation: "ensure_room", input });
    const existing = this.rooms.get(input.roomName);
    if (existing) {
      const existingConfiguration = this.roomConfigurations.get(input.roomName);
      if (
        !existingConfiguration ||
        existingConfiguration.maxParticipants !== input.maxParticipants ||
        existingConfiguration.emptyTimeoutSeconds !==
          input.emptyTimeoutSeconds ||
        existingConfiguration.departureTimeoutSeconds !==
          input.departureTimeoutSeconds ||
        (existingConfiguration.metadata ?? "") !== (input.metadata ?? "")
      )
        return Promise.reject(new LiveKitProviderError("reconcile_room"));
      return Promise.resolve(existing);
    }
    const created = {
      sid: `RM_FAKE_${String(this.rooms.size + 1)}`,
      name: input.roomName,
      maxParticipants: input.maxParticipants,
    };
    this.rooms.set(input.roomName, created);
    this.roomConfigurations.set(input.roomName, { ...input });
    return Promise.resolve(created);
  }

  listParticipants(roomName: string): Promise<LiveKitParticipantSnapshot[]> {
    this.operations.push({ operation: "list_participants", roomName });
    return Promise.resolve([...(this.participants.get(roomName) ?? [])]);
  }

  removeParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<void> {
    this.operations.push({
      operation: "remove_participant",
      roomName,
      participantIdentity,
    });
    const remaining = (this.participants.get(roomName) ?? []).filter(
      (participant) => participant.identity !== participantIdentity,
    );
    this.participants.set(roomName, remaining);
    return Promise.resolve();
  }

  closeRoom(roomName: string): Promise<void> {
    this.operations.push({ operation: "close_room", roomName });
    this.rooms.delete(roomName);
    this.roomConfigurations.delete(roomName);
    this.participants.delete(roomName);
    return Promise.resolve();
  }

  createJoinToken(
    input: CreateLiveKitJoinTokenInput,
  ): Promise<LiveKitJoinCredential> {
    this.operations.push({ operation: "create_join_token", input });
    return Promise.resolve({
      token: `fake-livekit-token:${input.role}:${input.roomName}:${input.participantIdentity}`,
      expiresAt: new Date(
        this.clock().getTime() + LIVEKIT_JOIN_TOKEN_TTL_SECONDS * 1_000,
      ),
    });
  }
}
