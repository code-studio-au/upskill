import { Room, TokenVerifier } from "livekit-server-sdk";
import type { ParticipantInfo } from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import { parseServerEnvironment } from "#/server/runtime-environment";
import { FakeLiveKitProvider } from "./livekit-provider.fake";
import {
  LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
  LiveKitCloudProvider,
  LiveKitProviderError,
  getEnabledLiveKitConfiguration,
  type EnabledLiveKitConfiguration,
  type LiveKitRoomCreationCoordinator,
} from "./livekit-provider.server";

const configuration: EnabledLiveKitConfiguration = {
  url: "ws://127.0.0.1:7880",
  apiKey: "development-key",
  apiSecret: "development-secret-with-at-least-32-characters",
  approvedMaxParticipants: 25,
  approvedMaxConcurrentRooms: 2,
};

function room(name = "room_generation_1"): Room {
  return new Room({ sid: "RM_1", name, maxParticipants: 20 });
}

function fakeApi() {
  return {
    room: {
      createRoom: vi.fn(({ name }: { name: string }) =>
        Promise.resolve(room(name)),
      ),
      listRooms: vi.fn(() => Promise.resolve([] as Room[])),
      listParticipants: vi.fn(() => Promise.resolve([] as ParticipantInfo[])),
      removeParticipant: vi.fn(() => Promise.resolve(undefined)),
      deleteRoom: vi.fn(() => Promise.resolve(undefined)),
    },
  };
}

const coordinateDirectly: LiveKitRoomCreationCoordinator = (operation) =>
  operation();

function serialRoomCreationCoordinator(): LiveKitRoomCreationCoordinator {
  let previous = Promise.resolve();
  return <Result>(operation: () => Promise<Result>) => {
    const result = previous.then(operation);
    previous = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

describe("LiveKit provider foundation", () => {
  it("does not configure a provider while the feature is disabled", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: "postgresql://upskill:upskill@localhost:5433/upskill",
      BETTER_AUTH_SECRET: "local-only-secret-with-more-than-32-characters",
      STRIPE_SECRET_KEY: "sk_test_local",
      STRIPE_WEBHOOK_SECRET: "whsec_local",
      LIVEKIT_ENABLED: "false",
    });
    expect(getEnabledLiveKitConfiguration(environment)).toBeNull();
  });

  it("creates a room once and validates the approved capacity", async () => {
    const api = fakeApi();
    const provider = new LiveKitCloudProvider(
      configuration,
      api,
      coordinateDirectly,
    );
    const input = {
      roomName: "room_generation_1",
      maxParticipants: 20,
      emptyTimeoutSeconds: 600,
      departureTimeoutSeconds: 60,
    };
    await expect(provider.ensureRoom(input)).resolves.toEqual({
      sid: "RM_1",
      name: "room_generation_1",
      maxParticipants: 20,
    });
    expect(api.room.createRoom).toHaveBeenCalledOnce();

    api.room.listRooms.mockResolvedValueOnce([room()]);
    await provider.ensureRoom(input);
    expect(api.room.createRoom).toHaveBeenCalledOnce();

    await expect(
      provider.ensureRoom({ ...input, maxParticipants: 26 }),
    ).rejects.toThrow("approved environment limit");
  });

  it("recovers an idempotent room-creation race", async () => {
    const api = fakeApi();
    api.room.createRoom.mockRejectedValueOnce(new Error("already exists"));
    api.room.listRooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([room()]);
    const provider = new LiveKitCloudProvider(
      configuration,
      api,
      coordinateDirectly,
    );
    await expect(
      provider.ensureRoom({
        roomName: "room_generation_1",
        maxParticipants: 20,
        emptyTimeoutSeconds: 600,
        departureTimeoutSeconds: 60,
      }),
    ).resolves.toMatchObject({ sid: "RM_1" });
  });

  it("prevents room creation at the approved concurrent-room limit", async () => {
    const api = fakeApi();
    api.room.listRooms
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([room("room_1"), room("room_2")]);
    const provider = new LiveKitCloudProvider(
      configuration,
      api,
      coordinateDirectly,
    );
    await expect(
      provider.ensureRoom({
        roomName: "room_generation_3",
        maxParticipants: 20,
        emptyTimeoutSeconds: 600,
        departureTimeoutSeconds: 60,
      }),
    ).rejects.toThrow("approved concurrent-room limit");
    expect(api.room.createRoom).not.toHaveBeenCalled();
  });

  it("serializes distinct room creation across provider instances", async () => {
    const rooms = new Map<string, Room>();
    const api = {
      room: {
        createRoom: vi.fn((input: { name: string }) => {
          const created = room(input.name);
          rooms.set(input.name, created);
          return Promise.resolve(created);
        }),
        listRooms: vi.fn((names?: string[]) =>
          Promise.resolve(
            names?.length
              ? names.flatMap((name) => {
                  const existing = rooms.get(name);
                  return existing ? [existing] : [];
                })
              : [...rooms.values()],
          ),
        ),
        listParticipants: vi.fn(() => Promise.resolve([] as ParticipantInfo[])),
        removeParticipant: vi.fn(() => Promise.resolve(undefined)),
        deleteRoom: vi.fn(() => Promise.resolve(undefined)),
      },
    };
    const coordinate = serialRoomCreationCoordinator();
    const limitedConfiguration = {
      ...configuration,
      approvedMaxConcurrentRooms: 1,
    };
    const firstProvider = new LiveKitCloudProvider(
      limitedConfiguration,
      api,
      coordinate,
    );
    const secondProvider = new LiveKitCloudProvider(
      limitedConfiguration,
      api,
      coordinate,
    );
    const input = {
      maxParticipants: 20,
      emptyTimeoutSeconds: 600,
      departureTimeoutSeconds: 60,
    };

    const outcomes = await Promise.allSettled([
      firstProvider.ensureRoom({ ...input, roomName: "room_generation_1" }),
      secondProvider.ensureRoom({ ...input, roomName: "room_generation_2" }),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(api.room.createRoom).toHaveBeenCalledOnce();
  });

  it("returns safe provider failures without the secret or provider message", async () => {
    const api = fakeApi();
    api.room.listRooms.mockRejectedValueOnce(
      new Error(`provider leaked ${configuration.apiSecret}`),
    );
    const provider = new LiveKitCloudProvider(
      configuration,
      api,
      coordinateDirectly,
    );
    const failure = await provider
      .checkHealth()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitProviderError);
    expect(String(failure)).toBe(
      "LiveKitProviderError: LiveKit provider operation failed: health",
    );
    expect(String(failure)).not.toContain(configuration.apiSecret);
  });

  it.each([
    ["attendee", false, undefined],
    [
      "presenter",
      true,
      ["camera", "microphone", "screen_share", "screen_share_audio"],
    ],
  ] as const)(
    "issues five-minute, exact-room %s grants",
    async (role, canPublish, canPublishSources) => {
      const provider = new LiveKitCloudProvider(
        configuration,
        fakeApi(),
        coordinateDirectly,
      );
      const token = await provider.createJoinToken({
        roomName: "room_generation_1",
        participantIdentity: `${role}:opaque_1`,
        displayName: role === "attendee" ? "Learner One" : "Presenter One",
        role,
      });
      const claims = await new TokenVerifier(
        configuration.apiKey,
        configuration.apiSecret,
      ).verify(token);
      expect(claims.video).toMatchObject({
        room: "room_generation_1",
        roomJoin: true,
        roomAdmin: false,
        canSubscribe: true,
        canPublish,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      expect(claims.video?.canPublishSources).toEqual(canPublishSources);
      expect(Number(claims.exp) - Number(claims.nbf)).toBe(
        LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
      );
    },
  );

  it("provides a deterministic fake without network access", async () => {
    const provider = new FakeLiveKitProvider();
    const input = {
      roomName: "room_generation_1",
      maxParticipants: 20,
      emptyTimeoutSeconds: 600,
      departureTimeoutSeconds: 60,
    };
    const first = await provider.ensureRoom(input);
    const second = await provider.ensureRoom(input);
    expect(first).toEqual(second);
    await expect(
      provider.createJoinToken({
        roomName: input.roomName,
        participantIdentity: "attendee:opaque_1",
        displayName: "Learner One",
        role: "attendee",
      }),
    ).resolves.toBe(
      "fake-livekit-token:attendee:room_generation_1:attendee:opaque_1",
    );
  });
});
