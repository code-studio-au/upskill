import { Paper, Stack, Title } from "@mantine/core";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
} from "react";
import classes from "./AppDialog.module.css";

interface AppDialogProps {
  children: ReactNode;
  closeDisabled?: boolean;
  descriptionId?: string;
  onClose: () => void;
  title: string;
}

const focusableSelector = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function AppDialog({
  children,
  closeDisabled = false,
  descriptionId,
  onClose,
  title,
}: AppDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeFromKeyboard = useEffectEvent(() => {
    if (!closeDisabled) onClose();
  });

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusable =
      dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
    focusable?.[0]?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFromKeyboard();
        return;
      }
      if (event.key !== "Tab") return;
      const currentFocusable =
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!currentFocusable || currentFocusable.length === 0) return;
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className={classes.backdrop}>
      <Paper
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        withBorder
        radius="lg"
        p={{ base: "lg", sm: "xl" }}
        shadow="xl"
        className={classes.dialog}
      >
        <Stack gap="md">
          <Title order={2} size="h3" id={titleId}>
            {title}
          </Title>
          {children}
        </Stack>
      </Paper>
    </div>
  );
}
