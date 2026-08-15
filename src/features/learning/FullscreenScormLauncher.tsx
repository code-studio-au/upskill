import { Button } from "#/features/shared/mantine";
import { useState } from "react";
import classes from "./FullscreenScormLauncher.module.css";

export interface FullscreenScormLauncherProps {
  title: string;
  payload: Record<string, number | string>;
  onExit: () => void;
}

export function FullscreenScormLauncher({
  title,
  payload,
  onExit,
}: FullscreenScormLauncherProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [launchUrl, setLaunchUrl] = useState<string>();
  return (
    <div className={classes.launcher}>
      <Button
        size="xs"
        loading={status === "loading"}
        onClick={(event) => {
          if (launchUrl) return void document.exitFullscreen();
          const player = event.currentTarget.parentElement;
          if (!player) return;
          player.onfullscreenchange = () => {
            if (!document.fullscreenElement) {
              setLaunchUrl(undefined);
              onExit();
            }
          };
          setStatus("loading");
          void player
            .requestFullscreen()
            .then(() =>
              fetch("/api/scorm/launches", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }),
            )
            .then(async (response) => {
              const result = (await response.json()) as { launchUrl?: string };
              if (!response.ok || !result.launchUrl) throw Error();
              setLaunchUrl(result.launchUrl);
              setStatus("idle");
            })
            .catch(() => {
              setStatus("error");
            });
        }}
      >
        {launchUrl
          ? "Click here to exit"
          : status === "error"
            ? "Retry"
            : "Launch"}
      </Button>
      {launchUrl ? (
        <iframe
          className={classes.frame}
          src={launchUrl}
          title={title}
          sandbox="allow-downloads allow-popups allow-same-origin allow-scripts"
        />
      ) : null}
    </div>
  );
}
