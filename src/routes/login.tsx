import {
  Alert,
  Button,
  Container,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useSyncExternalStore, type SyntheticEvent } from "react";
import { authClient } from "#/features/auth/auth-client";
import { loginSearchSchema } from "#/features/auth/login.schema";
import classes from "./login.module.css";

const subscribeToHydration = () => () => undefined;

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

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");

    if (typeof email !== "string" || typeof password !== "string") {
      setError("Enter your email address and password.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
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
              <TextInput
                label="Email address"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
              <PasswordInput
                label="Password"
                name="password"
                autoComplete="current-password"
                required
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
