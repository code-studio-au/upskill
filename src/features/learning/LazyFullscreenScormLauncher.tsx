import { lazy, Suspense } from "react";
import type { FullscreenScormLauncherProps } from "./FullscreenScormLauncher";
import { Button } from "#/features/shared/mantine";

const FullscreenScormLauncher = lazy(() =>
  import("./FullscreenScormLauncher").then((module) => ({
    default: module.FullscreenScormLauncher,
  })),
);

export function LazyFullscreenScormLauncher(
  props: FullscreenScormLauncherProps,
) {
  return (
    <Suspense
      fallback={
        <Button size="xs" loading disabled>
          Launch
        </Button>
      }
    >
      <FullscreenScormLauncher {...props} />
    </Suspense>
  );
}
