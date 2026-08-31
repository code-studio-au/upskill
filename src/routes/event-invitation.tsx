import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { eventLateInvitationTokenSchema } from "#/features/learner/event-late-invitation.schema";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  acceptEventLateInvitation,
  getEventLateInvitation,
} from "#/server/functions/event-late-invitation";
import classes from "./login.module.css";

const invitationResumeStoragePrefix = "upskill.event-invite.";

function readInvitationSecret(): {
  resumeStorageKey: string | null;
  token: string;
} {
  if (typeof window === "undefined")
    return { resumeStorageKey: null, token: "" };
  const fragmentToken = eventLateInvitationTokenSchema.safeParse(
    new URLSearchParams(window.location.hash.slice(1)).get("token"),
  );
  if (fragmentToken.success)
    return { resumeStorageKey: null, token: fragmentToken.data };
  const resumeId = new URLSearchParams(window.location.search).get("resume");
  if (!resumeId || resumeId.length !== 36 || /[^\da-f-]/u.test(resumeId))
    return { resumeStorageKey: null, token: "" };
  const resumeStorageKey = `${invitationResumeStoragePrefix}${resumeId}`;
  try {
    const resumedToken = eventLateInvitationTokenSchema.safeParse(
      window.sessionStorage.getItem(resumeStorageKey),
    );
    return {
      resumeStorageKey,
      token: resumedToken.success ? resumedToken.data : "",
    };
  } catch {
    return { resumeStorageKey: null, token: "" };
  }
}

function removeInvitationResume(resumeStorageKey: string | null): void {
  if (!resumeStorageKey) return;
  try {
    window.sessionStorage.removeItem(resumeStorageKey);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function redirectToInvitationLogin(
  token: string,
  previousResumeStorageKey: string | null,
): boolean {
  try {
    const resumeId = window.crypto.randomUUID();
    window.sessionStorage.setItem(
      `${invitationResumeStoragePrefix}${resumeId}`,
      token,
    );
    removeInvitationResume(previousResumeStorageKey);
    const destination = `/event-invitation?resume=${resumeId}`;
    window.location.assign(
      `/login?redirect=${encodeURIComponent(destination)}`,
    );
    return true;
  } catch {
    return false;
  }
}

type InvitationState =
  | { status: "loading" }
  | {
      status: "ready";
      invitationId: string;
      eventOccurrenceId: string;
      eventTitle: string;
      eventStartsAt: string;
      timezone: string;
      expiresAt: string;
    }
  | { status: "accepted"; eventOccurrenceId: string }
  | {
      status:
        | "expired"
        | "forbidden"
        | "ineligible"
        | "invalid"
        | "revoked"
        | "unavailable";
    };

export const Route = createFileRoute("/event-invitation")({
  ssr: false,
  head: () => ({ meta: [{ title: "Event invitation — Upskill" }] }),
  component: EventInvitationPage,
});

function EventInvitationPage() {
  const [{ resumeStorageKey, token }] = useState(readInvitationSecret);
  const [invitation, setInvitation] = useState<InvitationState>(
    token ? { status: "loading" } : { status: "invalid" },
  );
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    void getEventLateInvitation({ data: { token } })
      .then((result) => {
        if (!active) return;
        if (result.status === "unauthenticated") {
          if (!redirectToInvitationLogin(token, resumeStorageKey))
            setInvitation({ status: "unavailable" });
          return;
        }
        removeInvitationResume(resumeStorageKey);
        setInvitation(result);
      })
      .catch(() => {
        if (active) setInvitation({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [resumeStorageKey, token]);

  const accept = async () => {
    if (!token || invitation.status !== "ready") return;
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptEventLateInvitation({ data: { token } });
      if (result.status === "unauthenticated") {
        if (!redirectToInvitationLogin(token, null))
          setError("Sign-in continuation is unavailable in this browser.");
        return;
      }
      if (
        result.status === "registered" ||
        result.status === "already-registered"
      ) {
        window.location.assign("/my-events");
        return;
      }
      setInvitation({ status: result.status });
    } catch {
      setError("The invitation could not be accepted. Please try again.");
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Container size="sm" className={classes.section}>
      <Paper
        withBorder
        radius="lg"
        p={{ base: "lg", sm: "xl" }}
        className={classes.card}
      >
        {invitation.status === "loading" ? (
          <LoadingSpinner label="Loading event invitation" />
        ) : invitation.status === "ready" ? (
          <Stack gap="lg">
            <div>
              <Text c="indigo.7" fw={700}>
                Personal event invitation
              </Text>
              <Title order={1}>{invitation.eventTitle}</Title>
            </div>
            <Text>
              Event starts{" "}
              {formatLocalDateTime(invitation.eventStartsAt, {
                timeZone: invitation.timezone,
              })}
              . This invitation expires{" "}
              {formatLocalDateTime(invitation.expiresAt, {
                timeZone: invitation.timezone,
              })}
              .
            </Text>
            {error ? (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            ) : null}
            <Button loading={accepting} onClick={() => void accept()}>
              Accept invitation
            </Button>
          </Stack>
        ) : invitation.status === "accepted" ? (
          <Stack gap="lg">
            <Title order={1}>Invitation already accepted</Title>
            <Text>Your registration is available in My events.</Text>
            <Button component={Link} to="/my-events">
              View my events
            </Button>
          </Stack>
        ) : (
          <Stack gap="lg">
            <Title order={1}>Invitation unavailable</Title>
            <Alert color="red" role="alert">
              {invitation.status === "forbidden"
                ? "This invitation belongs to a different verified account."
                : invitation.status === "ineligible"
                  ? "Your account no longer meets this event's registration requirements."
                  : invitation.status === "revoked"
                    ? "This invitation has been revoked."
                    : invitation.status === "expired"
                      ? "This invitation has expired."
                      : invitation.status === "unavailable"
                        ? "This invitation cannot currently be accepted."
                        : "This invitation link is invalid."}
            </Alert>
            <Button component={Link} to="/my-events" variant="light">
              Go to My events
            </Button>
          </Stack>
        )}
      </Paper>
    </Container>
  );
}
