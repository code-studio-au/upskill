import type { EventVirtualPresenterCredential } from "./event-operations.schema";
import type * as LiveKitClient from "livekit-client";

type LiveKitClientModule = Pick<
  typeof LiveKitClient,
  "ConnectionState" | "isBrowserSupported" | "Room" | "RoomEvent" | "Track"
>;

export type LiveKitPresenterClientLoader = () => Promise<LiveKitClientModule>;

export interface PresenterMediaTrack {
  id: string;
  kind: "audio" | "video";
  source: string;
  participantName: string;
  local: boolean;
  muted: boolean;
  media: {
    attach(element: HTMLMediaElement): HTMLMediaElement;
    detach(element: HTMLMediaElement): HTMLMediaElement;
  };
}

export interface PresenterMediaSnapshot {
  connected: boolean;
  canPlaybackAudio: boolean;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenShareEnabled: boolean;
  tracks: Array<PresenterMediaTrack>;
}

export interface PresenterMediaSession {
  connect(credential: EventVirtualPresenterCredential): Promise<void>;
  dispose(): Promise<void>;
  enableAudio(): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setScreenShareEnabled(enabled: boolean): Promise<void>;
  snapshot(): PresenterMediaSnapshot;
  subscribe(listener: (snapshot: PresenterMediaSnapshot) => void): () => void;
}

export type PresenterMediaSessionResult =
  | { status: "ready"; session: PresenterMediaSession }
  | { status: "unsupported" };

const defaultClientLoader: LiveKitPresenterClientLoader = () =>
  import("livekit-client");

export async function isLiveKitPresenterMediaSupported(
  loadClient: LiveKitPresenterClientLoader = defaultClientLoader,
): Promise<boolean> {
  const client = await loadClient();
  return client.isBrowserSupported();
}

export async function createLiveKitPresenterMediaSession(
  loadClient: LiveKitPresenterClientLoader = defaultClientLoader,
): Promise<PresenterMediaSessionResult> {
  const client = await loadClient();
  if (!client.isBrowserSupported()) return { status: "unsupported" };

  const room = new client.Room({ adaptiveStream: true });
  const listeners = new Set<(snapshot: PresenterMediaSnapshot) => void>();
  let disposed = false;

  const snapshot = (): PresenterMediaSnapshot => {
    const localTracks: Array<PresenterMediaTrack> = [
      ...room.localParticipant.trackPublications.values(),
    ].flatMap((publication) => {
      const media = publication.track;
      if (!media) return [];
      const kind =
        publication.kind === client.Track.Kind.Video
          ? ("video" as const)
          : publication.kind === client.Track.Kind.Audio
            ? ("audio" as const)
            : null;
      if (!kind) return [];
      return [
        {
          id: `local:${publication.trackSid}`,
          kind,
          source: publication.source,
          participantName: "You",
          local: true,
          muted: publication.isMuted,
          media,
        },
      ];
    });
    const remoteTracks: Array<PresenterMediaTrack> = [
      ...room.remoteParticipants.values(),
    ].flatMap((participant) =>
      [...participant.trackPublications.values()].flatMap((publication) => {
        const media = publication.track;
        if (!media || !publication.isSubscribed) return [];
        const kind =
          publication.kind === client.Track.Kind.Video
            ? ("video" as const)
            : publication.kind === client.Track.Kind.Audio
              ? ("audio" as const)
              : null;
        if (!kind) return [];
        return [
          {
            id: `${participant.identity}:${publication.trackSid}`,
            kind,
            source: publication.source,
            participantName: participant.name?.trim() || "Presenter",
            local: false,
            muted: publication.isMuted,
            media,
          },
        ];
      }),
    );
    const activeLocalSources = new Set<string>();
    for (const track of localTracks)
      if (!track.muted) activeLocalSources.add(track.source);
    return {
      connected: room.state === client.ConnectionState.Connected,
      canPlaybackAudio: room.canPlaybackAudio,
      cameraEnabled: activeLocalSources.has(client.Track.Source.Camera),
      microphoneEnabled: activeLocalSources.has(client.Track.Source.Microphone),
      screenShareEnabled: activeLocalSources.has(
        client.Track.Source.ScreenShare,
      ),
      tracks: [...localTracks, ...remoteTracks],
    };
  };

  const notify = () => {
    if (disposed) return;
    const value = snapshot();
    for (const listener of listeners) listener(value);
  };

  const roomEvents = [
    client.RoomEvent.Connected,
    client.RoomEvent.Disconnected,
    client.RoomEvent.ParticipantConnected,
    client.RoomEvent.ParticipantDisconnected,
    client.RoomEvent.ParticipantNameChanged,
    client.RoomEvent.TrackSubscribed,
    client.RoomEvent.TrackUnsubscribed,
    client.RoomEvent.TrackMuted,
    client.RoomEvent.TrackUnmuted,
    client.RoomEvent.LocalTrackPublished,
    client.RoomEvent.LocalTrackUnpublished,
    client.RoomEvent.AudioPlaybackStatusChanged,
  ] as const;
  for (const event of roomEvents) room.on(event, notify);

  return {
    status: "ready",
    session: {
      async connect(credential) {
        if (disposed) throw new Error("Presenter media session was disposed");
        await room.connect(credential.websocketUrl, credential.token, {
          autoSubscribe: true,
        });
        notify();
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        for (const event of roomEvents) room.off(event, notify);
        await room.disconnect(true);
      },
      async enableAudio() {
        await room.startAudio();
        notify();
      },
      async setCameraEnabled(enabled) {
        await room.localParticipant.setCameraEnabled(enabled);
        notify();
      },
      async setMicrophoneEnabled(enabled) {
        await room.localParticipant.setMicrophoneEnabled(enabled);
        notify();
      },
      async setScreenShareEnabled(enabled) {
        await room.localParticipant.setScreenShareEnabled(enabled);
        notify();
      },
      snapshot,
      subscribe(listener) {
        if (disposed) return () => undefined;
        listeners.add(listener);
        listener(snapshot());
        return () => listeners.delete(listener);
      },
    },
  };
}
