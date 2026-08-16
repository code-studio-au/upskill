import { Alert, Button, Stack, Text } from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import {
  accessCodeInputSchema,
  type AccessCodeRedemptionResult,
} from "./access-code.schema";
import { redeemLearnerAccessCode } from "#/server/functions/learner";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
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
      body: `You're enrolled in ${result.courseTitle}.`,
    };
  }
  if (result.status === "already-enrolled") {
    return {
      color: "blue",
      title: "Already enrolled",
      body: `${result.courseTitle} is already in your learning area.`,
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
  const codeForm = useForm({
    defaultValues: { code: "" },
    validators: { onSubmit: accessCodeInputSchema },
    onSubmit: async ({ value }) => {
      setMessage(null);
      try {
        const result = await redeemLearnerAccessCode({ data: value });
        if (result.status === "unauthenticated") {
          window.location.assign("/login?redirect=%2Fdashboard");
          return;
        }
        setMessage(resultMessage(result));
        if (result.status === "enrolled") {
          codeForm.reset();
          await router.invalidate();
        }
      } catch {
        setMessage({
          color: "red",
          title: "Code not applied",
          body: "Access-code redemption is temporarily unavailable. Please try again.",
        });
      }
    },
  });

  return (
    <Stack gap="md">
      <Text c="dimmed">
        Enter the code supplied by your organisation to add the course to your
        learning area.
      </Text>
      {message ? (
        <Alert color={message.color} title={message.title} role="status">
          {message.body}
        </Alert>
      ) : null}
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
            selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          >
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={!hydrated || !canSubmit}
                className={classes.submit}
              >
                Apply access code
              </Button>
            )}
          </codeForm.Subscribe>
        </div>
      </form>
    </Stack>
  );
}
