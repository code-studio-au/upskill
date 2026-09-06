import type { EventVirtualAttendeeCredential } from "./event-virtual-lobby.schema";
import type * as LiveKitClient from "livekit-client";

type LiveKitClientModule = Pick<
  typeof LiveKitClient,
  | "ConnectionState"
  | "DisconnectReason"
  | "isBrowserSupported"
  | "Room"
  | "RoomEvent"
  | "Track"
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
  connectionState: "disconnected" | "connecting" | "connected" | "reconnecting";
  disconnectReason: AttendeeMediaDisconnectReason;
  canPlaybackAudio: boolean;
  tracks: Array<AttendeeMediaTrack>;
}

export type AttendeeMediaDisconnectReason =
  | "client_initiated"
  | "duplicate_identity"
  | "participant_removed"
  | "room_ended"
  | "connection_lost"
  | null;

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

export async function isLiveKitAttendeeMediaSupported(
  loadClient: LiveKitClientLoader = defaultClientLoader,
): Promise<boolean> {
  const client = await loadClient();
  return client.isBrowserSupported();
}

export async function createLiveKitAttendeeMediaSession(
  loadClient: LiveKitClientLoader = defaultClientLoader,
): Promise<AttendeeMediaSessionResult> {
  const client = await loadClient();
  if (!client.isBrowserSupported()) return { status: "unsupported" };

  const room = new client.Room({ adaptiveStream: true });
  const listeners = new Set<(snapshot: AttendeeMediaSnapshot) => void>();
  let disposed = false;
  let connectionState: AttendeeMediaSnapshot["connectionState"] =
    "disconnected";
  let disconnectReason: AttendeeMediaDisconnectReason = null;
  let signalReconnectPending = false;

  const snapshot = (): AttendeeMediaSnapshot => ({
    connected: connectionState === "connected",
    connectionState,
    disconnectReason,
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

  const handleConnected = () => {
    signalReconnectPending = false;
    connectionState = "connected";
    disconnectReason = null;
    notify();
  };
  const handleReconnecting = () => {
    signalReconnectPending = false;
    connectionState = "reconnecting";
    disconnectReason = null;
    notify();
  };
  const handleSignalReconnecting = () => {
    signalReconnectPending = true;
    connectionState = "reconnecting";
    disconnectReason = null;
    notify();
  };
  const handleSignalConnected = () => {
    if (!signalReconnectPending) return;
    handleConnected();
  };
  const handleDisconnected = (reason?: number) => {
    signalReconnectPending = false;
    connectionState = "disconnected";
    disconnectReason =
      reason === client.DisconnectReason.CLIENT_INITIATED
        ? "client_initiated"
        : reason === client.DisconnectReason.DUPLICATE_IDENTITY
          ? "duplicate_identity"
          : reason === client.DisconnectReason.PARTICIPANT_REMOVED
            ? "participant_removed"
            : reason === client.DisconnectReason.ROOM_DELETED ||
                reason === client.DisconnectReason.ROOM_CLOSED
              ? "room_ended"
              : "connection_lost";
    notify();
  };

  room.on(client.RoomEvent.Connected, handleConnected);
  room.on(client.RoomEvent.Reconnecting, handleReconnecting);
  room.on(client.RoomEvent.SignalReconnecting, handleSignalReconnecting);
  room.on(client.RoomEvent.SignalConnected, handleSignalConnected);
  room.on(client.RoomEvent.Reconnected, handleConnected);
  room.on(client.RoomEvent.Disconnected, handleDisconnected);
  room.on(client.RoomEvent.ParticipantConnected, notify);
  room.on(client.RoomEvent.ParticipantDisconnected, notify);
  room.on(client.RoomEvent.ParticipantNameChanged, notify);
  room.on(client.RoomEvent.TrackSubscribed, notify);
  room.on(client.RoomEvent.TrackUnsubscribed, notify);
  room.on(client.RoomEvent.TrackMuted, notify);
  room.on(client.RoomEvent.TrackUnmuted, notify);
  room.on(client.RoomEvent.AudioPlaybackStatusChanged, notify);

  const removeRoomListeners = () => {
    room.off(client.RoomEvent.Connected, handleConnected);
    room.off(client.RoomEvent.Reconnecting, handleReconnecting);
    room.off(client.RoomEvent.SignalReconnecting, handleSignalReconnecting);
    room.off(client.RoomEvent.SignalConnected, handleSignalConnected);
    room.off(client.RoomEvent.Reconnected, handleConnected);
    room.off(client.RoomEvent.Disconnected, handleDisconnected);
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
        connectionState = "connecting";
        disconnectReason = null;
        notify();
        await room.connect(credential.websocketUrl, credential.token, {
          autoSubscribe: true,
        });
        handleConnected();
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
