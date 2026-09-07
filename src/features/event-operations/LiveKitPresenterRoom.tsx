import { useEffect, useRef, useState } from "react";
import { type EventVirtualPresenterCredentialResult } from "./event-operations.schema";
import {
  prepareLiveKitPresenterJoin,
  presenterCredentialCanStartConnection,
} from "./livekit-presenter-join";
import {
  createLiveKitPresenterMediaSession,
  type PresenterMediaSession,
  type PresenterMediaSnapshot,
  type PresenterMediaTrack,
} from "./livekit-presenter-media";
import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import classes from "./LiveKitPresenterRoom.module.css";

type ConnectionPhase =
  | "closed"
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "leaving"
  | "left"
  | "unsupported"
  | "error";

type MediaControl = "camera" | "microphone" | "screen";

const emptySnapshot: PresenterMediaSnapshot = {
  connected: false,
  canPlaybackAudio: true,
  cameraEnabled: false,
  microphoneEnabled: false,
  screenShareEnabled: false,
  tracks: [],
};

function credentialErrorMessage(
  result: Exclude<EventVirtualPresenterCredentialResult, { status: "ready" }>,
): string {
  if (result.status === "unauthenticated")
    return "Your session expired. Sign in again to enter the green room.";
  if (result.status === "forbidden")
    return "Your assignment does not permit green-room access.";
  if (result.status === "not-found")
    return "This webinar session is unavailable.";
  if (result.reason === "capacity_exceeded")
    return "The webinar room is full. Try again shortly.";
  if (result.reason === "preparation_not_open")
    return "Presenter preparation has not opened yet.";
  if (result.reason === "provider_unavailable")
    return "LiveKit is unavailable or not configured.";
  if (result.reason === "session_ended")
    return "This webinar session has ended.";
  return "The green room is unavailable. Refresh and try again.";
}

function RemoteAudio({ track }: { track: PresenterMediaTrack }) {
  const element = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    track.media.attach(audio);
    return () => {
      track.media.detach(audio);
    };
  }, [track.media]);
  return (
    <audio
      ref={element}
      className={classes.audioTrack}
      aria-label={`${track.participantName} audio`}
      autoPlay
    />
  );
}

function PresenterVideo({ track }: { track: PresenterMediaTrack }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    track.media.attach(video);
    return () => {
      track.media.detach(video);
    };
  }, [track.media]);
  const screen = track.source.includes("screen");
  const label = screen
    ? track.local
      ? "Your shared screen"
      : `${track.participantName} shared screen`
    : track.participantName;
  return (
    <figure className={classes.videoTile}>
      <video
        ref={element}
        aria-label={`${label} video`}
        autoPlay
        muted
        playsInline
      />
      <figcaption>
        {label}
        {track.muted ? " — paused" : ""}
      </figcaption>
    </figure>
  );
}

export function LiveKitPresenterRoom({
  eventOccurrenceId,
  eventSessionId,
}: {
  eventOccurrenceId: string;
  eventSessionId: string;
}) {
  const [phase, setPhase] = useState<ConnectionPhase>("closed");
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] =
    useState<PresenterMediaSnapshot>(emptySnapshot);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [pendingControl, setPendingControl] = useState<MediaControl | null>(
    null,
  );
  const mediaSession = useRef<PresenterMediaSession | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const operation = useRef(0);
  const connectedOnce = useRef(false);

  useEffect(
    () => () => {
      operation.current += 1;
      unsubscribe.current?.();
      if (mediaSession.current) void mediaSession.current.dispose();
    },
    [],
  );

  const clearSession = async () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    const current = mediaSession.current;
    mediaSession.current = null;
    if (current) await current.dispose();
    setSnapshot(emptySnapshot);
    setAudioBlocked(false);
    connectedOnce.current = false;
  };

  const join = async () => {
    const currentOperation = operation.current + 1;
    operation.current = currentOperation;
    setMessage(null);
    setAudioBlocked(false);
    setPhase("requesting");
    try {
      await clearSession();
      if (operation.current !== currentOperation) return;
      const preparation = await prepareLiveKitPresenterJoin({
        eventOccurrenceId,
        eventSessionId,
      });
      if (operation.current !== currentOperation) return;
      if (preparation.status === "unsupported") {
        setPhase("unsupported");
        return;
      }
      const result = preparation.result;
      if (result.status !== "ready") {
        setMessage(credentialErrorMessage(result));
        setPhase("error");
        return;
      }
      if (!presenterCredentialCanStartConnection(result.credential.expiresAt)) {
        setMessage("The green-room credential expired. Try again.");
        setPhase("error");
        return;
      }
      setPhase("connecting");
      const created = await createLiveKitPresenterMediaSession();
      if (operation.current !== currentOperation) {
        if (created.status === "ready") await created.session.dispose();
        return;
      }
      if (created.status === "unsupported") {
        setPhase("unsupported");
        return;
      }
      mediaSession.current = created.session;
      unsubscribe.current = created.session.subscribe((nextSnapshot) => {
        if (operation.current !== currentOperation) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.connected) {
          connectedOnce.current = true;
          setPhase("connected");
        } else if (connectedOnce.current) {
          setPhase("disconnected");
        }
      });
      await created.session.connect(result.credential);
      if (operation.current !== currentOperation) return;
      try {
        await created.session.enableAudio();
      } catch {
        setAudioBlocked(true);
      }
    } catch {
      if (operation.current !== currentOperation) return;
      await clearSession();
      setMessage(
        "Could not connect to the green room. Check your connection and retry.",
      );
      setPhase("error");
    }
  };

  const leave = async () => {
    operation.current += 1;
    setPhase("leaving");
    setMessage(null);
    try {
      await clearSession();
    } finally {
      setPhase("left");
    }
  };

  const toggleMedia = async (
    control: MediaControl,
    enabled: boolean,
  ): Promise<void> => {
    const current = mediaSession.current;
    if (!current) return;
    setPendingControl(control);
    setMessage(null);
    try {
      if (control === "camera") await current.setCameraEnabled(enabled);
      else if (control === "microphone")
        await current.setMicrophoneEnabled(enabled);
      else await current.setScreenShareEnabled(enabled);
    } catch {
      setMessage(
        control === "screen"
          ? "Screen sharing did not start. Choose a screen or window and retry."
          : `The ${control} could not be ${enabled ? "enabled" : "disabled"}. Check this browser's site permissions and try again.`,
      );
    } finally {
      setPendingControl(null);
    }
  };

  const enableAudio = async () => {
    try {
      await mediaSession.current?.enableAudio();
      setAudioBlocked(false);
    } catch {
      setMessage(
        "Your browser is still blocking green-room audio. Check its site permissions and try again.",
      );
    }
  };

  const videos = snapshot.tracks.filter((track) => track.kind === "video");
  const remoteAudios = snapshot.tracks.filter(
    (track) => track.kind === "audio" && !track.local,
  );
  const statusMessage =
    phase === "requesting"
      ? "Requesting secure green-room access…"
      : phase === "connecting"
        ? "Connecting to the green room…"
        : phase === "connected"
          ? "Connected. Camera and microphone start off."
          : phase === "disconnected"
            ? "The green-room connection ended."
            : phase === "leaving"
              ? "Leaving the green room…"
              : phase === "left"
                ? "You left the green room."
                : phase === "unsupported"
                  ? "This browser cannot connect to LiveKit. Use a current version of Chrome, Firefox, Safari or Edge."
                  : message;

  if (phase === "closed")
    return (
      <Button
        variant="light"
        onClick={() => {
          setPhase("idle");
        }}
      >
        Show green room
      </Button>
    );

  return (
    <section className={classes.room} aria-labelledby="green-room-heading">
      <div className={classes.header}>
        <div>
          <h4 id="green-room-heading">Presenter green room</h4>
          <Text size="sm" c="dimmed">
            Attendees cannot connect until the webinar is started and they are
            admitted.
          </Text>
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
        </div>
        {["requesting", "connecting", "connected", "disconnected"].includes(
          phase,
        ) ? (
          <Button type="button" variant="light" onClick={() => void leave()}>
            {phase === "requesting" || phase === "connecting"
              ? "Cancel joining"
              : "Leave green room"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="light"
            onClick={() => {
              setPhase("closed");
            }}
          >
            Close green room panel
          </Button>
        )}
      </div>

      {message && phase === "connected" ? (
        <Alert color="red" role="alert">
          {message}
        </Alert>
      ) : null}

      {phase === "connected" ? (
        <Stack gap="md">
          <Group gap="sm" className={classes.controls}>
            <Button
              type="button"
              variant={snapshot.cameraEnabled ? "default" : "light"}
              aria-pressed={snapshot.cameraEnabled}
              loading={pendingControl === "camera"}
              disabled={pendingControl !== null}
              onClick={() =>
                void toggleMedia("camera", !snapshot.cameraEnabled)
              }
            >
              {snapshot.cameraEnabled ? "Turn camera off" : "Turn camera on"}
            </Button>
            <Button
              type="button"
              variant={snapshot.microphoneEnabled ? "default" : "light"}
              aria-pressed={snapshot.microphoneEnabled}
              loading={pendingControl === "microphone"}
              disabled={pendingControl !== null}
              onClick={() =>
                void toggleMedia("microphone", !snapshot.microphoneEnabled)
              }
            >
              {snapshot.microphoneEnabled
                ? "Mute microphone"
                : "Unmute microphone"}
            </Button>
            <Button
              type="button"
              variant={snapshot.screenShareEnabled ? "default" : "light"}
              aria-pressed={snapshot.screenShareEnabled}
              loading={pendingControl === "screen"}
              disabled={pendingControl !== null}
              onClick={() =>
                void toggleMedia("screen", !snapshot.screenShareEnabled)
              }
            >
              {snapshot.screenShareEnabled ? "Stop sharing" : "Share screen"}
            </Button>
          </Group>

          {audioBlocked || !snapshot.canPlaybackAudio ? (
            <Button type="button" onClick={() => void enableAudio()}>
              Enable green-room audio
            </Button>
          ) : null}

          <div className={classes.videoGrid}>
            {videos.length > 0 ? (
              videos.map((track) => (
                <PresenterVideo key={track.id} track={track} />
              ))
            ) : (
              <div className={classes.placeholder}>
                <p>
                  Connected. Turn on your camera or wait for another presenter.
                </p>
              </div>
            )}
          </div>
          {remoteAudios.map((track) => (
            <RemoteAudio key={track.id} track={track} />
          ))}
        </Stack>
      ) : null}

      {["idle", "left", "disconnected", "error"].includes(phase) ? (
        <Button type="button" onClick={() => void join()}>
          {phase === "idle" ? "Enter green room" : "Reconnect to green room"}
        </Button>
      ) : null}
    </section>
  );
}
