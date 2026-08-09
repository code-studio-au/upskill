import { Button, Stack, Text, Textarea } from "@mantine/core";
import { useState, type SyntheticEvent } from "react";
import { overrideAdminProgress } from "#/server/functions/admin";

interface ProgressOverrideControlsProps {
  enrollmentId: string;
  scope: "module" | "enrollment";
  modulePosition: number | null;
  currentState: "completed" | "incomplete";
  onChanged: () => Promise<void>;
}

function requiredModulePosition(value: number | null): number {
  if (value === null)
    throw new Error("Module progress controls require a module position");
  return value;
}

export function ProgressOverrideControls({
  enrollmentId,
  scope,
  modulePosition,
  currentState,
  onChanged,
}: ProgressOverrideControlsProps) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const targetState = currentState === "completed" ? "incomplete" : "completed";
  const subject = scope === "module" ? "module" : "course";

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await overrideAdminProgress({
        data:
          scope === "module"
            ? {
                enrollmentId,
                scope,
                modulePosition: requiredModulePosition(modulePosition),
                state: targetState,
                reason,
              }
            : {
                enrollmentId,
                scope,
                modulePosition: null,
                state: targetState,
                reason,
              },
      });
      if (result.status === "unauthenticated") {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (result.status === "forbidden") {
        setMessage("Your account no longer has administrator access.");
        return;
      }
      if (result.status === "not-found") {
        setMessage("This learning record is no longer available.");
        return;
      }
      setReason("");
      setMessage(
        result.data.outcome === "changed"
          ? `The ${subject} is now ${targetState}.`
          : `The ${subject} was already ${targetState}.`,
      );
      await onChanged();
    } catch {
      setMessage("The correction could not be recorded. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack gap="sm">
        <Textarea
          label={`Reason for marking this ${subject} ${targetState}`}
          description="Required for the permanent audit history (10–500 characters)."
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
          }}
          minLength={10}
          maxLength={500}
          autosize
          minRows={2}
          required
        />
        <Button
          type="submit"
          color={targetState === "incomplete" ? "orange" : "indigo"}
          variant="light"
          loading={pending}
          disabled={reason.trim().length < 10}
        >
          Mark {subject} {targetState}
        </Button>
        {message ? (
          <Text size="sm" role="status">
            {message}
          </Text>
        ) : null}
      </Stack>
    </form>
  );
}
