import { useEffect, useRef, useState } from "react";
import { type EventVirtualPresenterCredentialResult } from "./event-operations.schema";
import {
  prepareLiveKitPresenterJoin,
  presenterCredentialCanStartConnection,
} from "./livekit-presenter-join";
import {
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
  | "reconnecting"
  | "disconnected"
  | "duplicate"
  | "leaving"
  | "left"
  | "unsupported"
  | "error";

type MediaControl = "camera" | "microphone" | "screen";

const emptySnapshot: PresenterMediaSnapshot = {
  connectionState: "disconnected",
  duplicateIdentity: false,
  canPlaybackAudio: true,
  cameraEnabled: false,
  microphoneEnabled: false,
  screenShareEnabled: false,
  cameraOffPresenters: [],
  tracks: [],
};

const credentialFailureMessages: Record<string, string> = {
  unauthenticated: "Sign in again.",
  forbidden: "Access denied.",
  "not-found": "Webinar unavailable.",
  capacity_exceeded: "Webinar full. Try again.",
  preparation_not_open: "Preparation closed.",
  provider_unavailable: "LiveKit unavailable.",
  session_ended: "Webinar ended.",
};

function credentialErrorMessage(
  result: Exclude<EventVirtualPresenterCredentialResult, { status: "ready" }>,
): string {
  const key = result.status === "conflict" ? result.reason : result.status;
  return credentialFailureMessages[key] ?? "Green room unavailable.";
}

const phaseMessages: Partial<Record<ConnectionPhase, string>> = {
  requesting: "Requesting access…",
  connecting: "Connecting…",
  connected: "Connected. Media off.",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected.",
  duplicate: "Open in another tab or device.",
  leaving: "Leaving…",
  left: "Green room left.",
  unsupported: "Use a current browser.",
};

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
      if (operation.current !== currentOperation) {
        if (preparation.status === "credential-result")
          await preparation.session.dispose();
        return;
      }
      if (preparation.status === "unsupported") {
        setPhase("unsupported");
        return;
      }
      const result = preparation.result;
      if (result.status !== "ready") {
        await preparation.session.dispose();
        setMessage(credentialErrorMessage(result));
        setPhase("error");
        return;
      }
      if (!presenterCredentialCanStartConnection(result.credential.expiresAt)) {
        await preparation.session.dispose();
        setMessage("Credential expired. Try again.");
        setPhase("error");
        return;
      }
      setPhase("connecting");
      mediaSession.current = preparation.session;
      unsubscribe.current = preparation.session.subscribe((nextSnapshot) => {
        if (operation.current !== currentOperation) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.connectionState === "connected") {
          connectedOnce.current = true;
          setPhase("connected");
        } else if (
          nextSnapshot.connectionState === "reconnecting" &&
          connectedOnce.current
        ) {
          setPhase("reconnecting");
        } else if (connectedOnce.current) {
          setPhase(
            nextSnapshot.duplicateIdentity ? "duplicate" : "disconnected",
          );
        }
      });
      await preparation.session.connect(result.credential);
      if (operation.current !== currentOperation) return;
      try {
        await preparation.session.enableAudio();
      } catch {
        setAudioBlocked(true);
      }
    } catch {
      if (operation.current !== currentOperation) return;
      await clearSession();
      setMessage("Connection failed. Check network and retry.");
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
          ? "Screen sharing failed. Choose a screen and retry."
          : `Could not ${enabled ? "enable" : "disable"} the ${control}. Check browser permissions.`,
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
      setMessage("Audio blocked. Check permissions.");
    }
  };

  const videos = snapshot.tracks.filter(
    (track) => track.kind === "video" && !track.muted,
  );
  const remoteAudios = snapshot.tracks.filter(
    (track) => track.kind === "audio" && !track.local,
  );
  const mediaControls = [
    {
      control: "camera" as const,
      enabled: snapshot.cameraEnabled,
      enableLabel: "Turn camera on",
      disableLabel: "Turn camera off",
    },
    {
      control: "microphone" as const,
      enabled: snapshot.microphoneEnabled,
      enableLabel: "Unmute microphone",
      disableLabel: "Mute microphone",
    },
    {
      control: "screen" as const,
      enabled: snapshot.screenShareEnabled,
      enableLabel: "Share screen",
      disableLabel: "Stop sharing",
    },
  ];
  const statusMessage = phaseMessages[phase] ?? message;
  const roomActive = phase === "connected" || phase === "reconnecting";

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
            Attendees need start and admission.
          </Text>
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
        </div>
        {[
          "requesting",
          "connecting",
          "connected",
          "reconnecting",
          "disconnected",
        ].includes(phase) ? (
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

      {message && roomActive ? (
        <Alert color="red" role="alert">
          {message}
        </Alert>
      ) : null}

      {roomActive ? (
        <Stack gap="md">
          <Group gap="sm" className={classes.controls}>
            {mediaControls.map(
              ({ control, enabled, enableLabel, disableLabel }) => (
                <Button
                  key={control}
                  type="button"
                  variant={enabled ? "default" : "light"}
                  aria-pressed={enabled}
                  loading={pendingControl === control}
                  disabled={pendingControl !== null || phase === "reconnecting"}
                  onClick={() => void toggleMedia(control, !enabled)}
                >
                  {enabled ? disableLabel : enableLabel}
                </Button>
              ),
            )}
          </Group>

          {audioBlocked || !snapshot.canPlaybackAudio ? (
            <Button type="button" onClick={() => void enableAudio()}>
              Enable green-room audio
            </Button>
          ) : null}

          <div className={classes.videoGrid}>
            {videos.length === 0 &&
            snapshot.cameraOffPresenters.length === 0 ? (
              <div className={classes.placeholder}>
                <p>Waiting for presenter media.</p>
              </div>
            ) : null}
            {snapshot.cameraOffPresenters.map((participant) => (
              <div className={classes.placeholder} key={participant.id}>
                <p>{participant.participantName} — camera off</p>
              </div>
            ))}
            {videos.map((track) => (
              <PresenterVideo key={track.id} track={track} />
            ))}
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
