import { Alert, Button, Paper, Stack, Text, Title } from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore, type SyntheticEvent } from "react";
import {
  accessCodeInputSchema,
  type AccessCodeRedemptionResult,
} from "./access-code.schema";
import { redeemLearnerAccessCode } from "#/server/functions/learner";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
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
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [codeError, setCodeError] = useState<string>();

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validation = accessCodeInputSchema.safeParse({ code });
    if (!validation.success) {
      setCodeError(validation.error.issues[0]?.message);
      return;
    }
    setCodeError(undefined);
    setPending(true);
    setMessage(null);
    try {
      const result = await redeemLearnerAccessCode({ data: validation.data });
      if (result.status === "unauthenticated") {
        window.location.assign("/login?redirect=%2Fdashboard");
        return;
      }
      setMessage(resultMessage(result));
      if (result.status === "enrolled") {
        setCode("");
        await router.invalidate();
      }
    } catch {
      setMessage({
        color: "red",
        title: "Code not applied",
        body: "Access-code redemption is temporarily unavailable. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
      <Stack gap="md">
        <div>
          <Title order={2}>Have an access code?</Title>
          <Text c="dimmed" mt={4}>
            Enter the code supplied by your organisation to add the course to
            your learning area.
          </Text>
        </div>
        {message ? (
          <Alert color={message.color} title={message.title} role="status">
            {message.body}
          </Alert>
        ) : null}
        <form
          method="post"
          action="/dashboard"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <div className={classes.controls}>
            <MantineTextInput
              label="Access code"
              name="code"
              value={code}
              onChange={(event) => {
                setCode(event.currentTarget.value);
                setCodeError(undefined);
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              withAsterisk
              error={codeError}
              classNames={{ input: classes.codeInput }}
            />
            <Button
              type="submit"
              loading={pending}
              disabled={!hydrated}
              className={classes.submit}
            >
              Apply access code
            </Button>
          </div>
        </form>
      </Stack>
    </Paper>
  );
}
