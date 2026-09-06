import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveKitAttendeeMediaSession,
  isLiveKitAttendeeMediaSupported,
  type LiveKitClientLoader,
} from "./livekit-attendee-media";

const events = {
  Connected: "connected",
  Disconnected: "disconnected",
  ParticipantConnected: "participantConnected",
  ParticipantDisconnected: "participantDisconnected",
  ParticipantNameChanged: "participantNameChanged",
  TrackSubscribed: "trackSubscribed",
  TrackUnsubscribed: "trackUnsubscribed",
  TrackMuted: "trackMuted",
  TrackUnmuted: "trackUnmuted",
  AudioPlaybackStatusChanged: "audioPlaybackChanged",
} as const;

class FakeRoom {
  static last: FakeRoom | null = null;
  readonly listeners = new Map<string, Set<() => void>>();
  readonly remoteParticipants = new Map();
  readonly connect = vi.fn(() => {
    this.state = "connected";
    this.emit(events.Connected);
    return Promise.resolve();
  });
  readonly disconnect = vi.fn(() => {
    this.state = "disconnected";
    this.emit(events.Disconnected);
    return Promise.resolve();
  });
  readonly startAudio = vi.fn(() => {
    this.canPlaybackAudio = true;
    this.emit(events.AudioPlaybackStatusChanged);
    return Promise.resolve();
  });
  state = "disconnected";
  canPlaybackAudio = false;

  constructor(readonly options: { adaptiveStream?: boolean }) {
    FakeRoom.last = this;
  }

  on(event: string, listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

function fakeClient(supported = true): LiveKitClientLoader {
  return (() =>
    Promise.resolve({
      ConnectionState: { Connected: "connected" },
      isBrowserSupported: () => supported,
      Room: FakeRoom,
      RoomEvent: events,
      Track: { Kind: { Audio: "audio", Video: "video" } },
    })) as unknown as LiveKitClientLoader;
}

describe("LiveKit attendee media session", () => {
  beforeEach(() => {
    FakeRoom.last = null;
  });

  it("checks browser support without creating a room", async () => {
    await expect(
      isLiveKitAttendeeMediaSupported(fakeClient(false)),
    ).resolves.toBe(false);
    expect(FakeRoom.last).toBeNull();
  });

  it("refuses to create a room in an unsupported browser", async () => {
    expect(await createLiveKitAttendeeMediaSession(fakeClient(false))).toEqual({
      status: "unsupported",
    });
    expect(FakeRoom.last).toBeNull();
  });

  it("connects as an auto-subscribing receiver and disconnects explicitly", async () => {
    const result = await createLiveKitAttendeeMediaSession(fakeClient());
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    expect(room.options).toEqual({ adaptiveStream: true });

    const snapshots = vi.fn();
    result.session.subscribe(snapshots);
    await result.session.connect({
      token: "short-lived-token",
      websocketUrl: "wss://tenant.livekit.cloud",
      expiresAt: "2026-09-06T10:05:00.000Z",
      generation: 1,
    });
    expect(room.connect).toHaveBeenCalledWith(
      "wss://tenant.livekit.cloud",
      "short-lived-token",
      { autoSubscribe: true },
    );
    expect(result.session.snapshot().connected).toBe(true);

    await result.session.enableAudio();
    expect(result.session.snapshot().canPlaybackAudio).toBe(true);
    await result.session.disconnect();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    expect(result.session.snapshot().connected).toBe(false);
    expect(snapshots).toHaveBeenCalled();
  });

  it("projects only subscribed remote audio and video without local capture", async () => {
    const result = await createLiveKitAttendeeMediaSession(fakeClient());
    if (result.status !== "ready") throw new Error("Expected a ready session");
    const room = FakeRoom.last;
    if (!room) throw new Error("Expected a fake LiveKit room");
    const attach = vi.fn(
      (element: HTMLMediaElement): HTMLMediaElement => element,
    );
    const detach = vi.fn(
      (element: HTMLMediaElement): HTMLMediaElement => element,
    );
    room.remoteParticipants.set("presenter:one", {
      identity: "presenter:one",
      name: "  Dr Presenter  ",
      trackPublications: new Map([
        [
          "video-track",
          {
            trackSid: "video-track",
            kind: "video",
            source: "camera",
            isSubscribed: true,
            isMuted: false,
            track: { attach, detach },
          },
        ],
        [
          "audio-track",
          {
            trackSid: "audio-track",
            kind: "audio",
            source: "microphone",
            isSubscribed: true,
            isMuted: true,
            track: { attach, detach },
          },
        ],
        [
          "unsubscribed-track",
          {
            trackSid: "unsubscribed-track",
            kind: "video",
            source: "camera",
            isSubscribed: false,
            isMuted: false,
            track: { attach, detach },
          },
        ],
      ]),
    });

    const tracks = result.session.snapshot().tracks;
    expect(tracks).toHaveLength(2);
    expect(
      tracks.map(({ id, kind, participantName, muted }) => ({
        id,
        kind,
        participantName,
        muted,
      })),
    ).toEqual([
      {
        id: "presenter:one:video-track",
        kind: "video",
        participantName: "Dr Presenter",
        muted: false,
      },
      {
        id: "presenter:one:audio-track",
        kind: "audio",
        participantName: "Dr Presenter",
        muted: true,
      },
    ]);
    expect(room).not.toHaveProperty("localParticipant.setCameraEnabled");
    expect(room).not.toHaveProperty("localParticipant.setMicrophoneEnabled");
  });
});
