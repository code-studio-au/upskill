import { useEffect, useRef, useState } from "react";
import { type EventVirtualAttendeeCredentialResult } from "./event-virtual-lobby.schema";
import { prepareLiveKitAttendeeJoin } from "./livekit-attendee-join";
import {
  createLiveKitAttendeeMediaSession,
  type AttendeeMediaSession,
  type AttendeeMediaSnapshot,
  type AttendeeMediaTrack,
} from "./livekit-attendee-media";
import {
  attendeeCredentialDisposition,
  attendeeCredentialCanStartConnection,
  attendeeTerminalConnectionPhase,
  shouldReloadLobbyAfterDisconnect,
} from "./livekit-attendee-lifecycle";
import { Button } from "#/features/shared/mantine";
import classes from "./LiveKitAttendeeRoom.module.css";

type ConnectionPhase =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "duplicate"
  | "removed"
  | "ended"
  | "credential-expired"
  | "leaving"
  | "left"
  | "unsupported"
  | "error";

const emptySnapshot: AttendeeMediaSnapshot = {
  connectionState: "disconnected",
  disconnectReason: null,
  canPlaybackAudio: true,
  tracks: [],
};

function credentialErrorMessage(
  result: Exclude<EventVirtualAttendeeCredentialResult, { status: "ready" }>,
): string {
  if (result.status === "unauthenticated")
    return "Your verification has expired. Verify your registration again.";
  if (result.status === "not-found")
    return "This webinar link is no longer available.";
  const messages = {
    questionnaire_required:
      "Complete the registration questions before joining this webinar.",
    meeting_not_started: "The presenter has not started this webinar yet.",
    waiting_for_admission: "A presenter still needs to admit you.",
    recording_acknowledgement_required:
      "Acknowledge the recording notice before joining.",
    locked: "The presenter has temporarily locked this webinar.",
    ended: "This webinar has ended.",
    revoked: "Your webinar access is no longer available.",
    capacity_reached:
      "The webinar is currently full. Wait a moment and try again.",
    provider_unavailable:
      "The webinar connection is temporarily unavailable. Try again shortly.",
  } as const;
  return messages[result.reason];
}

function RemoteAudio({ track }: { track: AttendeeMediaTrack }) {
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

function RemoteVideo({ track }: { track: AttendeeMediaTrack }) {
  const element = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = element.current;
    if (!video) return;
    track.media.attach(video);
    return () => {
      track.media.detach(video);
    };
  }, [track.media]);
  const sourceLabel = track.source.includes("screen")
    ? "Shared screen"
    : track.participantName;
  return (
    <figure className={classes.videoTile}>
      <video
        ref={element}
        aria-label={`${sourceLabel} video`}
        autoPlay
        muted
        playsInline
      />
      <figcaption>
        {sourceLabel}
        {track.muted ? " — paused" : ""}
      </figcaption>
    </figure>
  );
}

export function LiveKitAttendeeRoom({
  publicReference,
}: {
  publicReference: string;
}) {
  const [phase, setPhase] = useState<ConnectionPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] =
    useState<AttendeeMediaSnapshot>(emptySnapshot);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const session = useRef<AttendeeMediaSession | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const request = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const connectedOnce = useRef(false);

  useEffect(
    () => () => {
      operation.current += 1;
      request.current?.abort();
      unsubscribe.current?.();
      if (session.current) void session.current.dispose();
    },
    [],
  );

  const clearSession = async () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    const current = session.current;
    session.current = null;
    if (current) await current.dispose();
    setSnapshot(emptySnapshot);
    connectedOnce.current = false;
  };

  const join = async () => {
    const currentOperation = operation.current + 1;
    operation.current = currentOperation;
    request.current?.abort();
    const abortController = new AbortController();
    request.current = abortController;
    setMessage(null);
    setAudioBlocked(false);
    setPhase("requesting");
    let credentialExpiresAt: string | null = null;
    try {
      await clearSession();
      if (operation.current !== currentOperation) return;
      const preparation = await prepareLiveKitAttendeeJoin(
        publicReference,
        abortController.signal,
      );
      if (operation.current !== currentOperation) return;
      if (preparation.status === "unsupported") {
        setPhase("unsupported");
        return;
      }
      const result = preparation.result;
      if (result.status !== "ready") {
        if (attendeeCredentialDisposition(result) === "reload-lobby") {
          window.location.reload();
          return;
        }
        setMessage(credentialErrorMessage(result));
        setPhase("error");
        return;
      }
      credentialExpiresAt = result.credential.expiresAt;
      if (!attendeeCredentialCanStartConnection(result.credential.expiresAt)) {
        setMessage(
          "The secure join credential expired before the connection could start.",
        );
        setPhase("credential-expired");
        return;
      }
      setPhase("connecting");
      const created = await createLiveKitAttendeeMediaSession();
      if (operation.current !== currentOperation) {
        if (created.status === "ready") await created.session.dispose();
        return;
      }
      if (created.status === "unsupported") {
        setPhase("unsupported");
        return;
      }
      session.current = created.session;
      unsubscribe.current = created.session.subscribe((nextSnapshot) => {
        if (operation.current !== currentOperation) return;
        setSnapshot(nextSnapshot);
        if (nextSnapshot.connectionState === "connected") {
          connectedOnce.current = true;
          setPhase("connected");
        } else if (nextSnapshot.connectionState === "connecting") {
          setPhase("connecting");
        } else if (
          nextSnapshot.connectionState === "reconnecting" &&
          connectedOnce.current
        ) {
          setPhase("reconnecting");
        } else if (
          nextSnapshot.connectionState === "disconnected" &&
          connectedOnce.current
        ) {
          const terminalPhase = attendeeTerminalConnectionPhase(
            nextSnapshot.disconnectReason,
          );
          const nextPhase =
            terminalPhase === "disconnected" &&
            credentialExpiresAt &&
            !attendeeCredentialCanStartConnection(credentialExpiresAt)
              ? "credential-expired"
              : terminalPhase;
          if (nextPhase === "credential-expired")
            setMessage(
              "The secure join credential expired while reconnecting. Request a new one to continue.",
            );
          setPhase(nextPhase);
          if (shouldReloadLobbyAfterDisconnect(terminalPhase))
            window.location.reload();
        }
      });
      await created.session.connect(result.credential);
      if (operation.current !== currentOperation) return;
      try {
        await created.session.enableAudio();
      } catch {
        setAudioBlocked(true);
      }
    } catch (error) {
      if (
        operation.current !== currentOperation ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      await clearSession();
      if (
        credentialExpiresAt &&
        !attendeeCredentialCanStartConnection(credentialExpiresAt)
      ) {
        setMessage(
          "The secure join credential expired before the connection finished.",
        );
        setPhase("credential-expired");
      } else {
        setMessage(
          "We could not connect to the webinar. Check your connection and try again.",
        );
        setPhase("error");
      }
    } finally {
      if (request.current === abortController) request.current = null;
    }
  };

  const leave = async () => {
    operation.current += 1;
    request.current?.abort();
    request.current = null;
    setPhase("leaving");
    setMessage(null);
    try {
      await clearSession();
    } finally {
      setPhase("left");
    }
  };

  const enableAudio = async () => {
    try {
      await session.current?.enableAudio();
      setAudioBlocked(false);
    } catch {
      setMessage(
        "Your browser is still blocking webinar audio. Check its site permissions and try again.",
      );
    }
  };

  const videos = snapshot.tracks.filter((track) => track.kind === "video");
  const audios = snapshot.tracks.filter((track) => track.kind === "audio");
  const statusMessage =
    phase === "requesting"
      ? "Requesting secure webinar access…"
      : phase === "connecting"
        ? "Connecting to the webinar…"
        : phase === "connected"
          ? "Connected to the webinar. Your camera and microphone are off."
          : phase === "reconnecting"
            ? "Your connection was interrupted. Reconnecting to the webinar…"
            : phase === "disconnected"
              ? "The webinar connection ended. Rejoin to ask Upskill to check your access again."
              : phase === "duplicate"
                ? "This webinar is open in another tab or browser. You can continue there or move the connection back to this tab."
                : phase === "removed"
                  ? "Your webinar access changed. Returning to the waiting room…"
                  : phase === "ended"
                    ? "The webinar has ended. Returning to the event page…"
                    : phase === "credential-expired"
                      ? message
                      : phase === "left"
                        ? "You left the webinar."
                        : phase === "unsupported"
                          ? "This browser cannot connect to the webinar. Use a current version of Chrome, Firefox, Safari or Edge."
                          : message;

  return (
    <section className={classes.room} aria-labelledby="webinar-media-heading">
      <div className={classes.roomHeader}>
        <div>
          <h2 id="webinar-media-heading">Webinar room</h2>
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
        </div>
        {["requesting", "connecting", "connected", "reconnecting"].includes(
          phase,
        ) ? (
          <Button type="button" variant="light" onClick={() => void leave()}>
            {phase === "requesting" || phase === "connecting"
              ? "Cancel joining"
              : "Leave webinar"}
          </Button>
        ) : null}
      </div>

      {phase === "connected" || phase === "reconnecting" ? (
        <div className={classes.mediaRegion}>
          <div className={classes.videoGrid}>
            {videos.length > 0 ? (
              videos.map((track) => (
                <RemoteVideo key={track.id} track={track} />
              ))
            ) : (
              <div className={classes.mediaPlaceholder}>
                <p>Connected. Waiting for presenter video or screen sharing.</p>
              </div>
            )}
          </div>
          {audios.map((track) => (
            <RemoteAudio key={track.id} track={track} />
          ))}
          {audioBlocked || !snapshot.canPlaybackAudio ? (
            <Button type="button" onClick={() => void enableAudio()}>
              Enable webinar audio
            </Button>
          ) : null}
        </div>
      ) : null}

      {[
        "idle",
        "left",
        "error",
        "disconnected",
        "duplicate",
        "credential-expired",
      ].includes(phase) ? (
        <Button type="button" onClick={() => void join()}>
          {phase === "duplicate"
            ? "Use this tab instead"
            : ["left", "disconnected", "credential-expired"].includes(phase)
              ? "Rejoin webinar"
              : "Join webinar"}
        </Button>
      ) : null}
    </section>
  );
}
