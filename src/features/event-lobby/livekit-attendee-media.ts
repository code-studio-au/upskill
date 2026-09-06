import type { EventVirtualAttendeeCredential } from "./event-virtual-lobby.schema";
import type * as LiveKitClient from "livekit-client";

type LiveKitClientModule = Pick<
  typeof LiveKitClient,
  "ConnectionState" | "isBrowserSupported" | "Room" | "RoomEvent" | "Track"
>;

export type LiveKitClientLoader = () => Promise<LiveKitClientModule>;

export interface AttendeeMediaTrack {
  id: string;
  kind: "audio" | "video";
  source: string;
  participantIdentity: string;
  participantName: string;
  muted: boolean;
  media: {
    attach(element: HTMLMediaElement): HTMLMediaElement;
    detach(element: HTMLMediaElement): HTMLMediaElement;
  };
}

export interface AttendeeMediaSnapshot {
  connected: boolean;
  canPlaybackAudio: boolean;
  tracks: Array<AttendeeMediaTrack>;
}

export interface AttendeeMediaSession {
  connect(credential: EventVirtualAttendeeCredential): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
  enableAudio(): Promise<void>;
  snapshot(): AttendeeMediaSnapshot;
  subscribe(listener: (snapshot: AttendeeMediaSnapshot) => void): () => void;
}

export type AttendeeMediaSessionResult =
  | { status: "ready"; session: AttendeeMediaSession }
  | { status: "unsupported" };

const defaultClientLoader: LiveKitClientLoader = () => import("livekit-client");

export async function createLiveKitAttendeeMediaSession(
  loadClient: LiveKitClientLoader = defaultClientLoader,
): Promise<AttendeeMediaSessionResult> {
  const client = await loadClient();
  if (!client.isBrowserSupported()) return { status: "unsupported" };

  const room = new client.Room({ adaptiveStream: true });
  const listeners = new Set<(snapshot: AttendeeMediaSnapshot) => void>();
  let disposed = false;

  const snapshot = (): AttendeeMediaSnapshot => ({
    connected: room.state === client.ConnectionState.Connected,
    canPlaybackAudio: room.canPlaybackAudio,
    tracks: [...room.remoteParticipants.values()].flatMap((participant) =>
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
            participantIdentity: participant.identity,
            participantName: participant.name?.trim() || "Presenter",
            muted: publication.isMuted,
            media,
          },
        ];
      }),
    ),
  });

  const notify = () => {
    if (disposed) return;
    const value = snapshot();
    for (const listener of listeners) listener(value);
  };

  room.on(client.RoomEvent.Connected, notify);
  room.on(client.RoomEvent.Disconnected, notify);
  room.on(client.RoomEvent.ParticipantConnected, notify);
  room.on(client.RoomEvent.ParticipantDisconnected, notify);
  room.on(client.RoomEvent.ParticipantNameChanged, notify);
  room.on(client.RoomEvent.TrackSubscribed, notify);
  room.on(client.RoomEvent.TrackUnsubscribed, notify);
  room.on(client.RoomEvent.TrackMuted, notify);
  room.on(client.RoomEvent.TrackUnmuted, notify);
  room.on(client.RoomEvent.AudioPlaybackStatusChanged, notify);

  const removeRoomListeners = () => {
    room.off(client.RoomEvent.Connected, notify);
    room.off(client.RoomEvent.Disconnected, notify);
    room.off(client.RoomEvent.ParticipantConnected, notify);
    room.off(client.RoomEvent.ParticipantDisconnected, notify);
    room.off(client.RoomEvent.ParticipantNameChanged, notify);
    room.off(client.RoomEvent.TrackSubscribed, notify);
    room.off(client.RoomEvent.TrackUnsubscribed, notify);
    room.off(client.RoomEvent.TrackMuted, notify);
    room.off(client.RoomEvent.TrackUnmuted, notify);
    room.off(client.RoomEvent.AudioPlaybackStatusChanged, notify);
  };

  return {
    status: "ready",
    session: {
      async connect(credential) {
        if (disposed) throw new Error("Attendee media session was disposed");
        await room.connect(credential.websocketUrl, credential.token, {
          autoSubscribe: true,
        });
        notify();
      },
      async disconnect() {
        await room.disconnect(true);
        notify();
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        listeners.clear();
        removeRoomListeners();
        await room.disconnect(true);
      },
      async enableAudio() {
        await room.startAudio();
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
