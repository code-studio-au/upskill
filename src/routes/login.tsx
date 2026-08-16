import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import {
  loginCredentialsSchema,
  loginSearchSchema,
} from "#/features/auth/login.schema";
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
  const [error, setError] = useState<string | null>(null);
  const loginForm = useForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: loginCredentialsSchema },
    onSubmit: async ({ value }) => {
      const validation = loginCredentialsSchema.safeParse(value);
      if (!validation.success) return;
      setError(null);
      try {
        const response = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validation.data),
        });
        if (!response.ok) {
          setError("We could not sign you in with those details.");
          return;
        }
        window.location.assign(redirect);
      } catch {
        setError("Sign-in is temporarily unavailable. Please try again.");
      }
    },
  });

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
              event.preventDefault();
              event.stopPropagation();
              void loginForm.handleSubmit();
            }}
          >
            <Stack gap="md">
              <loginForm.Field name="email">
                {(field) => (
                  <MantineTextInput
                    label="Email address"
                    name={field.name}
                    type="email"
                    autoComplete="email"
                    withAsterisk
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                  />
                )}
              </loginForm.Field>
              <loginForm.Field name="password">
                {(field) => (
                  <MantineTextInput
                    type="password"
                    label="Password"
                    name={field.name}
                    autoComplete="current-password"
                    withAsterisk
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                  />
                )}
              </loginForm.Field>
              <loginForm.Subscribe
                selector={(state) =>
                  [state.canSubmit, state.isSubmitting] as const
                }
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={!hydrated || !canSubmit}
                    fullWidth
                  >
                    Sign in
                  </Button>
                )}
              </loginForm.Subscribe>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Container>
  );
}
