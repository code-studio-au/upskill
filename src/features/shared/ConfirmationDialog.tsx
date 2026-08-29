import { Button, Group, Text } from "#/features/shared/mantine";
import { useId } from "react";
import { AppDialog } from "./AppDialog";

interface ConfirmationDialogProps {
  cancelLabel?: string;
  confirmColor?: "blue" | "gray" | "green" | "indigo" | "red";
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
  const descriptionId = useId();

  return (
    <AppDialog
      title={title}
      descriptionId={descriptionId}
      onClose={onCancel}
      closeDisabled={pending}
    >
      <Text id={descriptionId}>{description}</Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button color={confirmColor} onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </Group>
    </AppDialog>
  );
}
