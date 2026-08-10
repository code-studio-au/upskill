import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { authClient } from "#/features/auth/auth-client";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  loginCredentialsSchema,
  loginSearchSchema,
} from "#/features/auth/login.schema";
import classes from "./login.module.css";

const subscribeToHydration = () => () => undefined;

interface LoginFieldErrors {
  email?: string;
  password?: string;
}

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  ssr: true,
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const validation = loginCredentialsSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!validation.success) {
      const nextErrors: LoginFieldErrors = {};
      for (const issue of validation.error.issues) {
        if (issue.path[0] === "email" && !nextErrors.email)
          nextErrors.email = issue.message;
        if (issue.path[0] === "password" && !nextErrors.password)
          nextErrors.password = issue.message;
      }
      setFieldErrors(nextErrors);
      return;
    }

    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await authClient.signIn.email(validation.data);
      if (result.error) {
        setError("We could not sign you in with those details.");
        return;
      }
      window.location.assign(redirect);
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Container size="sm" className={classes.section}>
      <Paper
        withBorder
        radius="lg"
        p={{ base: "lg", sm: "xl" }}
        className={classes.card}
      >
        <Stack gap="lg">
          <div className={classes.intro}>
            <Text c="indigo.7" fw={700}>
              Learner access
            </Text>
            <Title order={1}>Sign in to Upskill</Title>
            <Text c="dimmed" mt="xs">
              Continue courses and discover learning available to your work
              email.
            </Text>
          </div>
          {error ? (
            <Alert color="red" title="Sign-in failed" role="alert">
              {error}
            </Alert>
          ) : null}
          <form
            method="post"
            action="/login"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <Stack gap="md">
              <MantineTextInput
                label="Email address"
                name="email"
                type="email"
                autoComplete="email"
                withAsterisk
                error={fieldErrors.email}
                onChange={() => {
                  setFieldErrors((current) =>
                    current.password ? { password: current.password } : {},
                  );
                }}
              />
              <MantineTextInput
                type="password"
                label="Password"
                name="password"
                autoComplete="current-password"
                withAsterisk
                error={fieldErrors.password}
                onChange={() => {
                  setFieldErrors((current) =>
                    current.email ? { email: current.email } : {},
                  );
                }}
              />
              <Button
                type="submit"
                loading={pending}
                disabled={!hydrated}
                fullWidth
              >
                Sign in
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
