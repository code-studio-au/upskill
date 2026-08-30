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
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  accountSetupPasswordSchema,
  accountSetupContinuePathSchema,
  accountSetupTokenSchema,
} from "#/features/auth/account-setup.schema";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import { getAccountSetupRequest } from "#/server/functions/account-setup";
import classes from "./login.module.css";

export const Route = createFileRoute("/account/setup")({
  ssr: false,
  head: () => ({ meta: [{ title: "Set up your account — Upskill" }] }),
  component: AccountSetupPage,
});

function AccountSetupPage() {
  const [{ token, continuePath }] = useState(() => {
    if (typeof window === "undefined")
      return { token: "", continuePath: "/dashboard" };
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const parsedToken = accountSetupTokenSchema.safeParse(
      parameters.get("token"),
    );
    const parsedContinuePath = accountSetupContinuePathSchema.safeParse(
      parameters.get("continue"),
    );
    return {
      token: parsedToken.success ? parsedToken.data : "",
      continuePath: parsedContinuePath.success
        ? parsedContinuePath.data
        : "/dashboard",
    };
  });
  const [request, setRequest] = useState<
    | { status: "loading" }
    | { status: "active" }
    | { status: "ready"; name: string; email: string }
    | { status: "invalid" }
    | { status: "unavailable" }
  >(token ? { status: "loading" } : { status: "invalid" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    let active = true;
    void getAccountSetupRequest({ data: { token } })
      .then((result) => {
        if (!active) return;
        if (result.status === "active") {
          setRequest(result);
          window.location.assign(continuePath);
          return;
        }
        setRequest(result);
      })
      .catch(() => {
        if (active) setRequest({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [continuePath, token]);
  const form = useForm({
    defaultValues: { password: "", confirmPassword: "" },
    validators: { onSubmit: accountSetupPasswordSchema },
    onSubmit: async ({ value }) => {
      if (request.status !== "ready" || !token) return;
      const parsed = accountSetupPasswordSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      try {
        const reset = await fetch("/api/auth/reset-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            newPassword: parsed.data.password,
          }),
        });
        if (!reset.ok) {
          setError("This setup link is invalid or has expired.");
          return;
        }
        const signIn = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: request.email,
            password: parsed.data.password,
          }),
        });
        if (!signIn.ok) {
          window.location.assign("/login");
          return;
        }
        window.location.assign(continuePath);
      } catch {
        setError("Account setup is temporarily unavailable. Please try again.");
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
        {request.status === "loading" ? (
          <LoadingSpinner label="Loading account setup" />
        ) : request.status === "active" ? (
          <LoadingSpinner label="Continuing to your invitation" />
        ) : request.status === "invalid" ? (
          <Stack gap="lg">
            <Title order={1}>Setup link unavailable</Title>
            <Alert color="red" role="alert">
              This account setup link is invalid, expired or has already been
              used.
            </Alert>
            <Link to="/login" search={{ redirect: "/dashboard" }}>
              <Button component="span">Go to sign in</Button>
            </Link>
          </Stack>
        ) : request.status === "unavailable" ? (
          <Alert color="red" title="Account setup unavailable" role="alert">
            Account setup is temporarily unavailable. Please try again.
          </Alert>
        ) : (
          <Stack gap="lg">
            <div className={classes.intro}>
              <Title order={1}>Set up your account</Title>
              <Text c="dimmed">{request.email}</Text>
            </div>
            {error ? (
              <Alert color="red" title="Account setup failed" role="alert">
                {error}
              </Alert>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <Stack gap="md">
                <form.Field name="password">
                  {(field) => (
                    <MantineTextInput
                      label="Password"
                      type="password"
                      autoComplete="new-password"
                      withAsterisk
                      value={field.state.value}
                      error={firstFormError(field.state.meta.errors)}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.currentTarget.value);
                      }}
                    />
                  )}
                </form.Field>
                <form.Field name="confirmPassword">
                  {(field) => (
                    <MantineTextInput
                      label="Confirm password"
                      type="password"
                      autoComplete="new-password"
                      withAsterisk
                      value={field.state.value}
                      error={firstFormError(field.state.meta.errors)}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.currentTarget.value);
                      }}
                    />
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) =>
                    [state.canSubmit, state.isSubmitting] as const
                  }
                >
                  {([canSubmit, isSubmitting]) => (
                    <Button
                      type="submit"
                      loading={isSubmitting}
                      disabled={!canSubmit}
                      fullWidth
                    >
                      Set password and continue
                    </Button>
                  )}
                </form.Subscribe>
              </Stack>
            </form>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
