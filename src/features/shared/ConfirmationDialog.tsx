import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useEffect, useEffectEvent, useId, useRef } from "react";
import classes from "./ConfirmationDialog.module.css";

interface ConfirmationDialogProps {
  cancelLabel?: string;
  confirmColor?: string;
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  title: string;
}

export function ConfirmationDialog({
  cancelLabel = "Cancel",
  confirmColor = "red",
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  pending = false,
  title,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancelFromKeyboard = useEffectEvent(() => {
    if (!pending) onCancel();
  });

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelFromKeyboard();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
    <div className={classes.backdrop} data-testid="confirmation-backdrop">
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
          <Text id={descriptionId}>{description}</Text>
          <Group justify="flex-end">
            <Button
              ref={cancelButtonRef}
              variant="default"
              onClick={onCancel}
              disabled={pending}
            >
              {cancelLabel}
            </Button>
            <Button color={confirmColor} onClick={onConfirm} loading={pending}>
              {confirmLabel}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </div>
  );
}
