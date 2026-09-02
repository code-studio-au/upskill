import { useEffect, useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { Badge } from "#/features/shared/Badge";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import {
  type RegistrationQuestionnaireAdminDetail,
  type RegistrationQuestionnaireAdminTarget,
} from "./admin-registration-questionnaire.schema";
import {
  getAdminRegistrationQuestionnaire,
  waiveAdminRegistrationQuestionnaire,
} from "#/server/functions/registration-questionnaire";

export function AdminRegistrationQuestionnaireDialog({
  learnerName,
  target,
  onClose,
  onChanged,
}: {
  learnerName: string;
  target: RegistrationQuestionnaireAdminTarget;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<
    RegistrationQuestionnaireAdminDetail | null | undefined
  >();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const request = getAdminRegistrationQuestionnaire({ data: target });
    void request.then((result) => {
      if (!active) return;
      setDetail(result.status === "ready" ? result.data : null);
    });
    return () => {
      active = false;
    };
  }, [target]);

  async function waive() {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      setError("Enter a reason for the waiver.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await waiveAdminRegistrationQuestionnaire({
        data: { target, reason: trimmedReason },
      });
      if (result.status !== "ready") {
        setError(
          result.status === "conflict"
            ? "This questionnaire has already been completed or waived."
            : "The waiver could not be recorded.",
        );
        return;
      }
      onChanged();
      onClose();
    } finally {
      setPending(false);
    }
  }

  const canWaive =
    detail &&
    detail.status !== "not_required" &&
    detail.status !== "completed" &&
    detail.status !== "waived";

  return (
    <AppDialog
      title={`Registration details — ${learnerName}`}
      onClose={onClose}
      closeDisabled={pending}
    >
      <Stack gap="md">
        {typeof detail === "undefined" ? (
          <Text>Loading registration response…</Text>
        ) : null}
        {detail === null ? (
          <Alert color="red">
            The registration response could not be loaded.
          </Alert>
        ) : null}
        {error ? <Alert color="red">{error}</Alert> : null}
        {detail ? (
          <>
            <Group gap="sm">
              <Badge variant="light">
                {detail.status === "assigned"
                  ? "Not started"
                  : detail.status.replaceAll("_", " ")}
              </Badge>
              {detail.surveyTitle ? (
                <Text size="sm">
                  {detail.surveyTitle} · version {detail.surveyVersion}
                </Text>
              ) : null}
            </Group>
            {detail.answers.length ? (
              <Stack gap="sm">
                {detail.answers.map((answer) => (
                  <div key={answer.questionId}>
                    <Text fw={700} size="sm">
                      {answer.prompt}
                    </Text>
                    <Text>{answer.answer}</Text>
                  </div>
                ))}
                <Text c="dimmed" size="sm">
                  Profile update consent:{" "}
                  {detail.profileUpdateAccepted ? "Yes" : "No"}
                </Text>
              </Stack>
            ) : detail.status === "completed" ? (
              <Text>No answer values were recorded.</Text>
            ) : null}
            {detail.status === "waived" ? (
              <Alert title="Waiver recorded">
                {detail.waiverReason}
                {detail.waivedByName ? ` — ${detail.waivedByName}` : ""}
              </Alert>
            ) : null}
            {canWaive ? (
              <Stack gap="sm">
                <MantineTextInput
                  label="Waiver reason"
                  description="Waiving allows access without a submitted response and is retained in the audit history."
                  value={reason}
                  maxLength={1_000}
                  disabled={pending}
                  onChange={(event) => {
                    setReason(event.currentTarget.value);
                  }}
                />
                <Group justify="flex-end">
                  <Button
                    color="red"
                    loading={pending}
                    onClick={() => {
                      void waive();
                    }}
                  >
                    Waive requirement
                  </Button>
                </Group>
              </Stack>
            ) : null}
          </>
        ) : null}
      </Stack>
    </AppDialog>
  );
}
