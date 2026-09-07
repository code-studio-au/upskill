import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveKitPresenterMediaSession,
  isLiveKitPresenterMediaSupported,
  type LiveKitPresenterClientLoader,
} from "./livekit-presenter-media";

const events = {
  Connected: "connected",
  Reconnecting: "reconnecting",
  SignalReconnecting: "signalReconnecting",
  SignalConnected: "signalConnected",
  Reconnected: "reconnected",
  Disconnected: "disconnected",
  ParticipantConnected: "participantConnected",
  ParticipantDisconnected: "participantDisconnected",
  ParticipantNameChanged: "participantNameChanged",
  TrackSubscribed: "trackSubscribed",
  TrackUnsubscribed: "trackUnsubscribed",
  TrackMuted: "trackMuted",
  TrackUnmuted: "trackUnmuted",
  LocalTrackPublished: "localTrackPublished",
  LocalTrackUnpublished: "localTrackUnpublished",
  AudioPlaybackStatusChanged: "audioPlaybackChanged",
} as const;

const kinds = { Audio: "audio", Video: "video" } as const;
const sources = {
  Camera: "camera",
  Microphone: "microphone",
  ScreenShare: "screen_share",
} as const;

function mediaTrack() {
  return { attach: vi.fn(), detach: vi.fn() };
}

class FakeLocalParticipant {
  readonly identity = "staff:presenter-1";
  readonly trackPublications = new Map<string, Record<string, unknown>>();
  readonly setCameraEnabled = vi.fn((enabled: boolean) => {
    this.setSource("camera", "video", enabled);
    return Promise.resolve();
  });
  readonly setMicrophoneEnabled = vi.fn((enabled: boolean) => {
    this.setSource("microphone", "audio", enabled);
    return Promise.resolve();
  });
  readonly setScreenShareEnabled = vi.fn((enabled: boolean) => {
    this.setSource("screen_share", "video", enabled);
    return Promise.resolve();
  });

  private setSource(source: string, kind: string, enabled: boolean) {
    const existing = this.trackPublications.get(source);
    this.trackPublications.set(source, {
      ...(existing ?? {
        track: mediaTrack(),
        trackSid: `local-${source}`,
        kind,
        source,
      }),
      isMuted: !enabled,
    });
  }
}

class FakeRoom {
  static last: FakeRoom | null = null;
  readonly listeners = new Map<
    string,
    Set<(...arguments_: Array<unknown>) => void>
  >();
  readonly localParticipant = new FakeLocalParticipant();
  readonly remoteParticipants = new Map<string, Record<string, unknown>>();
  readonly connect = vi.fn(() => {
    this.state = "connected";
    this.emit(events.Connected);
    return Promise.resolve();
  });
  readonly disconnect = vi.fn(() => {
    this.state = "disconnected";
    return Promise.resolve();
  });
  readonly startAudio = vi.fn(() => {
    this.canPlaybackAudio = true;
    return Promise.resolve();
  });
  state = "disconnected";
  canPlaybackAudio = false;

  constructor(readonly options: { adaptiveStream?: boolean }) {
    FakeRoom.last = this;
  }

  on(event: string, listener: (...arguments_: Array<unknown>) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: (...arguments_: Array<unknown>) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...arguments_: Array<unknown>) {
    for (const listener of this.listeners.get(event) ?? [])
      listener(...arguments_);
  }
}

function fakeClient(supported = true): LiveKitPresenterClientLoader {
  return (() =>
    Promise.resolve({
      ConnectionState: {
        Connected: "connected",
        Connecting: "connecting",
        Disconnected: "disconnected",
        Reconnecting: "reconnecting",
        SignalReconnecting: "signalReconnecting",
      },
      DisconnectReason: {
        CLIENT_INITIATED: 1,
        DUPLICATE_IDENTITY: 2,
        PARTICIPANT_REMOVED: 4,
        ROOM_DELETED: 5,
        ROOM_CLOSED: 10,
      },
      isBrowserSupported: () => supported,
      Room: FakeRoom,
      RoomEvent: events,
      Track: { Kind: kinds, Source: sources },
    })) as unknown as LiveKitPresenterClientLoader;
}

describe("LiveKit presenter media session", () => {
  beforeEach(() => {
    FakeRoom.last = null;
  });

  it("checks support without creating a provider room client", async () => {
    await expect(
      isLiveKitPresenterMediaSupported(fakeClient(false)),
    ).resolves.toBe(false);
    expect(FakeRoom.last).toBeNull();
  });

  it("refuses to create a media session in an unsupported browser", async () => {
    await expect(
      createLiveKitPresenterMediaSession(fakeClient(false)),
    ).resolves.toEqual({ status: "unsupported" });
    expect(FakeRoom.last).toBeNull();
  });

  it("connects with presenter publishing controls disabled by default", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");

    await result.session.connect({
      token: "short-lived-presenter-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:05:00.000Z",
      generation: 1,
    });
    expect(room.options).toEqual({ adaptiveStream: true });
    expect(room.connect).toHaveBeenCalledWith(
      "wss://tenant.livekit.cloud",
      "short-lived-presenter-token",
      { autoSubscribe: true },
    );
    expect(result.session.snapshot()).toMatchObject({
      connectionState: "connected",
      duplicateIdentity: false,
      cameraEnabled: false,
      microphoneEnabled: false,
      screenShareEnabled: false,
    });

    await result.session.setCameraEnabled(true);
    await result.session.setMicrophoneEnabled(true);
    await result.session.setScreenShareEnabled(true);
    expect(result.session.snapshot()).toMatchObject({
      cameraEnabled: true,
      microphoneEnabled: true,
      screenShareEnabled: true,
    });
    await result.session.setMicrophoneEnabled(false);
    expect(result.session.snapshot().microphoneEnabled).toBe(false);
  });

  it("projects local media and subscribed remote presenter media only", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    await result.session.setCameraEnabled(true);
    const subscribedVideo = mediaTrack();
    const subscribedAudio = mediaTrack();
    const remotePresenter = {
      identity: "staff_presenter-2",
      name: "Presenter Two",
      trackPublications: new Map([
        [
          "remote-video",
          {
            track: subscribedVideo,
            trackSid: "remote-video",
            kind: "video",
            source: "camera",
            isMuted: false,
            isSubscribed: true,
          },
        ],
        [
          "remote-audio",
          {
            track: subscribedAudio,
            trackSid: "remote-audio",
            kind: "audio",
            source: "microphone",
            isMuted: false,
            isSubscribed: true,
          },
        ],
        [
          "unsubscribed",
          {
            track: mediaTrack(),
            trackSid: "unsubscribed",
            kind: "video",
            source: "screen_share",
            isMuted: false,
            isSubscribed: false,
          },
        ],
      ]),
    };
    room.remoteParticipants.set("staff_presenter-2", remotePresenter);

    room.emit(events.ParticipantConnected, remotePresenter);
    expect(result.session.snapshot().tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ local: true, source: "camera" }),
        expect.objectContaining({
          local: false,
          participantName: "Presenter Two",
          source: "camera",
        }),
        expect.objectContaining({
          local: false,
          participantName: "Presenter Two",
          source: "microphone",
        }),
      ]),
    );
    expect(
      result.session
        .snapshot()
        .tracks.some((track) => track.id.includes("unsubscribed")),
    ).toBe(false);

    expect(result.session.snapshot().cameraOffPresenters).toEqual([]);
    expect(
      result.session
        .snapshot()
        .cameraOffPresenters.some(
          (participant) => participant.id === "staff_presenter-2",
        ),
    ).toBe(false);

    await result.session.dispose();
    await result.session.dispose();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    expect(
      [...room.listeners.values()].every((listeners) => listeners.size === 0),
    ).toBe(true);
  });

  it("projects connected participants even before they publish media", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    const remotePresenter = {
      identity: "staff_presenter-2",
      name: "Presenter Two",
      trackPublications: new Map(),
    };
    room.remoteParticipants.set("staff_presenter-2", remotePresenter);

    room.emit(events.ParticipantConnected, remotePresenter);

    expect(result.session.snapshot().cameraOffPresenters).toEqual([
      {
        id: "staff_presenter-2",
        participantName: "Presenter Two",
      },
    ]);
  });

  it("does not project attendee tiles or media into the presenter grid", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    for (let index = 0; index < 1_000; index += 1) {
      const suffix = String(index);
      room.remoteParticipants.set(`attendee:${suffix}`, {
        identity: `attendee:${suffix}`,
        name: `Attendee ${suffix}`,
        trackPublications: new Map(
          index === 0
            ? [
                [
                  "unexpected-camera",
                  {
                    track: mediaTrack(),
                    trackSid: "unexpected-camera",
                    kind: "video",
                    source: "camera",
                    isMuted: false,
                    isSubscribed: true,
                  },
                ],
              ]
            : [],
        ),
      });
    }

    room.emit(events.Connected);

    expect(result.session.snapshot()).toMatchObject({
      cameraOffPresenters: [],
      tracks: [],
    });
  });

  it("reports automatic reconnect progress until media recovery completes", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    await result.session.connect({
      token: "short-lived-presenter-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:05:00.000Z",
      generation: 1,
    });

    room.state = "signalReconnecting";
    room.emit(events.SignalReconnecting);
    room.state = "reconnecting";
    room.emit(events.Reconnecting);
    room.emit(events.SignalConnected);
    expect(result.session.snapshot()).toMatchObject({
      connectionState: "reconnecting",
    });

    room.state = "connected";
    room.emit(events.Reconnected);
    expect(result.session.snapshot()).toMatchObject({
      connectionState: "connected",
    });
  });

  it("clears a signal-only reconnect after signalling recovers", async () => {
    const result = await createLiveKitPresenterMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    await result.session.connect({
      token: "short-lived-presenter-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:05:00.000Z",
      generation: 1,
    });

    room.state = "signalReconnecting";
    room.emit(events.SignalReconnecting);
    expect(result.session.snapshot().connectionState).toBe("reconnecting");

    room.state = "connected";
    room.emit(events.SignalConnected);
    expect(result.session.snapshot()).toMatchObject({
      connectionState: "connected",
      duplicateIdentity: false,
    });
  });

  it.each([
    [2, true],
    [4, false],
    [undefined, false],
  ] as const)(
    "identifies duplicate disconnect reason %s as %s",
    async (reason, expected) => {
      const result = await createLiveKitPresenterMediaSession(fakeClient());
      if (result.status !== "ready")
        throw new Error("Expected a ready session");
      const room = FakeRoom.last;
      if (!room) throw new Error("Expected a fake LiveKit room");
      await result.session.connect({
        token: "short-lived-presenter-token",
        websocketUrl: "wss://tenant.livekit.cloud",
        expiresAt: "2026-09-06T10:05:00.000Z",
        generation: 1,
      });

      room.state = "disconnected";
      room.emit(events.Disconnected, reason);

      expect(result.session.snapshot()).toMatchObject({
        connectionState: "disconnected",
        duplicateIdentity: expected,
      });
    },
  );
});
