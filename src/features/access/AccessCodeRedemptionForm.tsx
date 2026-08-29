import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import {
  accessCodeInputSchema,
  type AccessCodePreviewResult,
  type AccessCodeRedemptionResult,
} from "./access-code.schema";
import {
  previewLearnerAccessCode,
  redeemLearnerAccessCode,
} from "#/server/functions/learner";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { firstFormError } from "#/features/shared/form-errors";
import classes from "./AccessCodeRedemptionForm.module.css";

const subscribeToHydration = () => () => undefined;

type Message =
  | { color: "green" | "blue"; title: string; body: string }
  | { color: "red"; title: string; body: string };

function resultMessage(result: AccessCodeRedemptionResult): Message | null {
  if (result.status === "enrolled") {
    return {
      color: "green",
      title: "Access code applied",
      body: `You now have access to ${result.offeringTitle}.`,
    };
  }
  if (result.status === "already-enrolled") {
    return {
      color: "blue",
      title: "Already enrolled",
      body: `${result.offeringTitle} is already in your ${result.offeringType === "event" ? "events" : "learning"} area.`,
    };
  }
  if (result.status === "activated") {
    return {
      color: "green",
      title: "Enterprise access activated",
      body: `${result.offeringTitle} is linked to your account. Automatically fulfilled learning is now in your learning and events areas; other covered offerings remain available from the catalogue.`,
    };
  }
  if (result.status === "already-activated") {
    return {
      color: "blue",
      title: "Enterprise access already active",
      body: `${result.offeringTitle} is already linked to your account.`,
    };
  }
  if (result.status === "invalid") {
    return {
      color: "red",
      title: "Code not accepted",
      body: "This access code is invalid, expired, unavailable, or not eligible for your verified email.",
    };
  }
  return null;
}

export function AccessCodeRedemptionForm() {
  const router = useRouter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [message, setMessage] = useState<Message | null>(null);
  const [preview, setPreview] = useState<Extract<
    AccessCodePreviewResult,
    { status: "ready" }
  > | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [redemptionComplete, setRedemptionComplete] = useState(false);
  const codeForm = useForm({
    defaultValues: { code: "" },
    validators: { onSubmit: accessCodeInputSchema },
    onSubmit: async ({ value }) => {
      setMessage(null);
      try {
        const result = await previewLearnerAccessCode({ data: value });
        if (result.status === "unauthenticated") {
          window.location.assign("/login?redirect=%2Fdashboard");
          return;
        }
        if (result.status === "ready") {
          setPreview(result);
          setAccepted(false);
          return;
        }
        setMessage(resultMessage(result));
      } catch {
        setMessage({
          color: "red",
          title: "Code not applied",
          body: "Access-code redemption is temporarily unavailable. Please try again.",
        });
      }
    },
  });

  async function confirmRedemption(): Promise<void> {
    if (!preview || !accepted) return;
    setRedeeming(true);
    setMessage(null);
    try {
      const result = await redeemLearnerAccessCode({
        data: {
          code: codeForm.state.values.code,
          informationReleaseAccepted: true,
          noticeVersion: preview.noticeVersion,
        },
      });
      if (result.status === "unauthenticated") {
        window.location.assign("/login?redirect=%2Fdashboard");
        return;
      }
      setMessage(resultMessage(result));
      if (result.status === "enrolled" || result.status === "activated") {
        setRedemptionComplete(true);
        setPreview(null);
        setAccepted(false);
        codeForm.reset();
        await router.invalidate();
      }
    } catch {
      setMessage({
        color: "red",
        title: "Code not applied",
        body: "Access-code redemption is temporarily unavailable. Please try again.",
      });
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <Stack gap="md">
      {message ? (
        <Alert color={message.color} title={message.title} role="status">
          {message.body}
        </Alert>
      ) : null}
      {!preview && !redemptionComplete ? (
        <form
          method="post"
          action="/dashboard"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void codeForm.handleSubmit();
          }}
        >
          <div className={classes.controls}>
            <codeForm.Field name="code">
              {(field) => (
                <MantineTextInput
                  label="Access code"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  withAsterisk
                  error={firstFormError(field.state.meta.errors)}
                  classNames={{ input: classes.codeInput }}
                />
              )}
            </codeForm.Field>
            <codeForm.Subscribe
              selector={(state) =>
                [state.canSubmit, state.isSubmitting] as const
              }
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!hydrated || !canSubmit}
                  className={classes.submit}
                >
                  Continue
                </Button>
              )}
            </codeForm.Subscribe>
          </div>
        </form>
      ) : null}
      {preview ? (
        <Paper withBorder radius="lg" p="md">
          <Stack gap="md">
            <div>
              <Title order={3} size="h4">
                Information release confirmation
              </Title>
              <Text fw={600}>{preview.offeringTitle}</Text>
              <Text size="sm" c="dimmed">
                {preview.accessKind === "enterprise_contract"
                  ? "Enterprise access"
                  : "Bulk-purchased access"}{" "}
                provided by {preview.organizationName}
              </Text>
            </div>
            <Alert color="blue">
              By continuing, you allow {preview.organizationName} and its
              assigned Access Owners to view your name, the email used for this
              redemption,{" "}
              {preview.offeringType === "catalogue"
                ? "covered course enrolments and event registrations"
                : `this ${preview.offeringType}`}
              , your progress and completion status. They cannot view your
              survey answers, detailed SCORM data, other learning, or unrelated
              profile information.
            </Alert>
            <MantineCheckbox
              checked={accepted}
              onChange={setAccepted}
              label="I understand and agree to release this information to the access provider."
            />
            <Group justify="flex-end">
              <Button
                type="button"
                variant="default"
                disabled={redeeming}
                onClick={() => {
                  setPreview(null);
                  setAccepted(false);
                }}
              >
                Change code
              </Button>
              <Button
                type="button"
                loading={redeeming}
                disabled={!hydrated || !accepted}
                onClick={() => void confirmRedemption()}
              >
                {preview.offeringType === "catalogue"
                  ? "Agree and activate access"
                  : "Agree and enrol"}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
