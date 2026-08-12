import { Button, Stack, Text } from "#/features/shared/mantine";
import { useState } from "react";
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
          }
        : {
            enrollmentId,
            scope,
            modulePosition: null,
            state: targetState,
          },
    );
  }

  function reviewCorrection(): void {
    const validation = adminProgressOverrideInputSchema.safeParse(
      scope === "module"
        ? {
            enrollmentId,
            scope,
            modulePosition,
            state: targetState,
          }
        : {
            enrollmentId,
            scope,
            modulePosition: null,
            state: targetState,
          },
    );
    if (!validation.success) {
      setMessage("This learning record cannot be corrected.");
      return;
    }
    setMessage(null);
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
    <>
      <Stack gap="sm">
        <Button
          type="button"
          color={targetState === "incomplete" ? "red" : "indigo"}
          variant="light"
          disabled={pending}
          onClick={reviewCorrection}
        >
          Mark {subject} {targetState}
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
          description={`Mark this ${subject} ${targetState}? The administrator, time and state change will be retained in the audit history.`}
          confirmColor={targetState === "incomplete" ? "red" : "indigo"}
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
    </>
  );
}
