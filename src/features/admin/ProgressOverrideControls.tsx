import { Button, Stack, Text, Textarea } from "@mantine/core";
import { useState, type SyntheticEvent } from "react";
import {
  adminProgressOverrideInputSchema,
  type AdminProgressOverrideInput,
} from "#/features/admin/admin.schema";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
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
  const [reasonError, setReasonError] = useState<string>();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const targetState = currentState === "completed" ? "incomplete" : "completed";
  const subject = scope === "module" ? "module" : "course";

  function input(): AdminProgressOverrideInput {
    return adminProgressOverrideInputSchema.parse(
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
    );
  }

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const validation = adminProgressOverrideInputSchema.safeParse(
      scope === "module"
        ? {
            enrollmentId,
            scope,
            modulePosition,
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
    );
    if (!validation.success) {
      setReasonError(
        validation.error.issues.find((issue) => issue.path[0] === "reason")
          ?.message ?? "Enter a valid reason for this correction.",
      );
      return;
    }
    setReasonError(undefined);
    setConfirmationOpen(true);
  }

  async function applyOverride(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const result = await overrideAdminProgress({
        data: input(),
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
      setConfirmationOpen(false);
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
    <form onSubmit={submit}>
      <Stack gap="sm">
        <Textarea
          label={`Reason for marking this ${subject} ${targetState}`}
          description="Required for the permanent audit history (10–500 characters)."
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            setReasonError(undefined);
          }}
          maxLength={500}
          autosize
          minRows={2}
          withAsterisk
          error={reasonError}
        />
        <Button
          type="submit"
          color={targetState === "incomplete" ? "orange" : "indigo"}
          variant="light"
          disabled={pending}
        >
          Review correction
        </Button>
        {message ? (
          <Text size="sm" role="status">
            {message}
          </Text>
        ) : null}
      </Stack>
      {confirmationOpen ? (
        <ConfirmationDialog
          title="Confirm progress correction"
          description={`Mark this ${subject} ${targetState}? The reason will be retained permanently in the audit history.`}
          confirmColor={targetState === "incomplete" ? "orange" : "indigo"}
          confirmLabel={`Mark ${subject} ${targetState}`}
          pending={pending}
          onCancel={() => {
            setConfirmationOpen(false);
          }}
          onConfirm={() => {
            void applyOverride();
          }}
        />
      ) : null}
    </form>
  );
}
