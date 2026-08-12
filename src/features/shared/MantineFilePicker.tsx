import { Button, Group, Stack, Text } from "#/features/shared/mantine";
import { useId } from "react";
import classes from "./MantineFilePicker.module.css";

interface MantineFilePickerProps {
  accept: string;
  description?: string;
  disabled?: boolean;
  error?: string | undefined;
  label: string;
  onChange: (file: File | null) => void;
  placeholder: string;
  required?: boolean;
  value: File | null;
}

export function MantineFilePicker({
  accept,
  description,
  disabled = false,
  error,
  label,
  onChange,
  placeholder,
  required = false,
  value,
}: MantineFilePickerProps) {
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [
    description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Stack gap={4}>
      <Text component="span" size="sm" fw={500}>
        {label}
        {required ? " *" : ""}
      </Text>
      {description ? (
        <Text id={descriptionId} c="dimmed" size="xs">
          {description}
        </Text>
      ) : null}
      <Group gap="sm" align="center">
        <Button component="label" variant="default" disabled={disabled}>
          {placeholder}
          <input
            className={classes.input}
            type="file"
            accept={accept}
            disabled={disabled}
            aria-label={label}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy || undefined}
            onClick={(event) => {
              event.currentTarget.value = "";
            }}
            onChange={(event) => {
              onChange(event.currentTarget.files?.[0] ?? null);
            }}
          />
        </Button>
        <Text className={classes.fileName ?? ""} size="sm" c="dimmed">
          {value?.name ?? "No file selected"}
        </Text>
        {value ? (
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={disabled}
            onClick={() => {
              onChange(null);
            }}
          >
            Clear
          </Button>
        ) : null}
      </Group>
      {error ? (
        <Text id={errorId} c="red" size="xs">
          {error}
        </Text>
      ) : null}
    </Stack>
  );
}
