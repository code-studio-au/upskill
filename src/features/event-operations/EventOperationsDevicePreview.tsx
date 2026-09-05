import { useEffect, useRef, useState } from "react";
import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import classes from "./EventOperations.module.css";

export function EventOperationsDevicePreview() {
  const video = useRef<HTMLVideoElement>(null);
  const requestGeneration = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () =>
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
  }, [stream]);

  useEffect(
    () => () => {
      requestGeneration.current += 1;
    },
    [],
  );

  const stop = () => {
    requestGeneration.current += 1;
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    setStream(null);
  };

  const start = async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setError(null);
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      if (requestGeneration.current !== generation) {
        nextStream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      setStream(nextStream);
    } catch {
      if (requestGeneration.current !== generation) return;
      setError(
        "Camera or microphone access was unavailable. Check this browser's site permissions and try again.",
      );
    }
  };

  return (
    <Stack gap="sm">
      <div>
        <Text fw={700}>Device preview</Text>
        <Text c="dimmed" size="sm">
          This preview stays on this device and does not connect to the webinar.
        </Text>
      </div>
      {stream ? (
        <video
          ref={video}
          className={classes.devicePreview}
          autoPlay
          muted
          playsInline
          aria-label="Camera preview"
        />
      ) : null}
      {error ? <Alert color="red">{error}</Alert> : null}
      <Button variant="light" onClick={stream ? stop : () => void start()}>
        {stream ? "Stop preview" : "Test camera and microphone"}
      </Button>
    </Stack>
  );
}
