import { createFileRoute, redirect } from "@tanstack/react-router";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import type { LearnerProfile } from "#/features/profile/learner-profile.schema";
import { getLearnerProfile } from "#/server/functions/profile";
import classes from "./profile.module.css";

const profileStatuses = new Set([
  "updated",
  "invalid",
  "email-code-sent",
  "sms-code-sent",
  "email-invalid",
  "sms-invalid",
  "email-expired",
  "sms-expired",
  "email-rate-limited",
  "sms-rate-limited",
  "email-verified",
  "sms-verified",
  "verification-unavailable",
]);

function profileLocation(status: string): string {
  return `/profile?status=${encodeURIComponent(status)}`;
}

function redirectResponse(location: string, cookies: Array<string> = []) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function statusMessage(status: string | undefined): {
  color: "green" | "red" | "orange" | "blue";
  title: string;
  message: string;
} | null {
  if (status === "updated")
    return {
      color: "green",
      title: "Profile updated",
      message: "Your current details and communication preferences were saved.",
    };
  if (status === "invalid")
    return {
      color: "red",
      title: "Check your details",
      message: "Some profile details were invalid or no longer available.",
    };
  if (status?.endsWith("code-sent"))
    return {
      color: "blue",
      title: "Code sent",
      message: "Enter the 6-digit code below. It expires in 10 minutes.",
    };
  if (status?.endsWith("-verified"))
    return {
      color: "green",
      title: "Contact verified",
      message: "Your verification status has been updated.",
    };
  if (status?.endsWith("-invalid"))
    return {
      color: "red",
      title: "Incorrect code",
      message: "Check the code and try again.",
    };
  if (status?.endsWith("-expired"))
    return {
      color: "orange",
      title: "Code expired",
      message: "Request a new verification code.",
    };
  if (status?.endsWith("-rate-limited"))
    return {
      color: "orange",
      title: "Please wait",
      message: "Too many attempts were made. Try again later.",
    };
  if (status === "verification-unavailable")
    return {
      color: "red",
      title: "Verification unavailable",
      message: "The code could not be sent. Try again later.",
    };
  return null;
}

export const Route = createFileRoute("/profile")({
  validateSearch: (search) => ({
    status:
      typeof search.status === "string" && profileStatuses.has(search.status)
        ? search.status
        : undefined,
  }),
  ssr: true,
  loader: async () => {
    const result = await getLearnerProfile();
    if (result.status === "unauthenticated")
      throw redirect({ to: "/login", search: { redirect: "/profile" } });
    return result.data;
  },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getServerEnv } = await import("#/server/env.server");
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return new Response(null, { status: 403 });
        const { getRequestUser } = await import("#/server/auth/session.server");
        const user = await getRequestUser();
        if (!user) return new Response(null, { status: 401 });
        const form = await request.formData();
        const intent = form.get("intent");
        const contracts =
          await import("#/features/profile/learner-profile.schema");
        if (intent === "update") {
          const input = contracts.learnerProfileUpdateSchema.safeParse({
            name: form.get("name"),
            phone: form.get("phone"),
            currentRegionId: form.get("currentRegionId"),
            emailEnabled: form.has("emailEnabled"),
            smsEnabled: form.has("smsEnabled"),
          });
          if (!input.success)
            return redirectResponse(profileLocation("invalid"));
          const { updateLearnerProfile } =
            await import("#/server/profile/learner-profile.server");
          const result = await updateLearnerProfile(input.data, user);
          return redirectResponse(
            profileLocation(
              result.status === "updated" ? "updated" : "invalid",
            ),
          );
        }
        const verification =
          await import("#/server/profile/profile-contact-verification.server");
        if (intent === "request") {
          const input = contracts.profileVerificationRequestSchema.safeParse({
            channel: form.get("channel"),
          });
          if (!input.success)
            return redirectResponse(
              profileLocation("verification-unavailable"),
            );
          const result = await verification.requestProfileContactVerification(
            input.data.channel,
            user,
          );
          if (result.status !== "sent")
            return redirectResponse(
              profileLocation(
                result.status === "verified"
                  ? `${input.data.channel}-verified`
                  : result.status === "rate-limited"
                    ? `${input.data.channel}-rate-limited`
                    : "verification-unavailable",
              ),
            );
          return redirectResponse(
            profileLocation(`${input.data.channel}-code-sent`),
            [
              verification.profileVerificationChallengeCookie(
                result.challengeReference,
              ),
            ],
          );
        }
        const input = contracts.profileVerificationCodeSchema.safeParse({
          channel: form.get("channel"),
          code: form.get("code"),
        });
        const challengeReference =
          verification.readProfileVerificationChallengeCookie(request);
        if (!input.success || !challengeReference)
          return redirectResponse(profileLocation("verification-unavailable"));
        const result = await verification.verifyProfileContactCode(
          { challengeReference, code: input.data.code },
          user,
        );
        return redirectResponse(
          profileLocation(
            `${result.channel ?? input.data.channel}-${result.status}`,
          ),
          result.status === "verified"
            ? [verification.clearProfileVerificationChallengeCookie()]
            : [],
        );
      },
    },
  },
  component: ProfilePage,
});

function ProfilePage() {
  const profile = Route.useLoaderData();
  const { status } = Route.useSearch();
  const notice = statusMessage(status);
  return (
    <Container size="lg" className={classes.section}>
      <Stack gap="xl">
        <div className={classes.heading}>
          <Text c="indigo.7" fw={700}>
            Learner account
          </Text>
          <Title order={1}>My profile</Title>
          <Text c="dimmed" mt="xs">
            Keep your contact details, region and communication preferences up
            to date.
          </Text>
        </div>
        {notice ? (
          <Alert color={notice.color} title={notice.title} role="status">
            {notice.message}
          </Alert>
        ) : null}
        <div className={classes.layout}>
          <ProfileDetails profile={profile} />
          <ContactVerification profile={profile} status={status} />
        </div>
      </Stack>
    </Container>
  );
}

function ProfileDetails({ profile }: { profile: LearnerProfile }) {
  const regionOptions = [
    { value: "", label: "No region selected" },
    ...profile.regions.map((region) => ({
      value: region.id,
      label: `${region.groupName ? `${region.groupName} — ` : ""}${region.name}${region.active ? "" : " (unavailable)"}`,
      disabled: !region.active,
    })),
  ];
  return (
    <form method="post">
      <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
        <Stack gap="lg">
          <div>
            <Title order={2}>Current details</Title>
            <Text c="dimmed" size="sm" mt="xs">
              These fields are populated from your onboarding profile and can be
              kept current here.
            </Text>
          </div>
          <div className={classes.detailsGrid}>
            <MantineTextInput
              name="name"
              label="Full name"
              autoComplete="name"
              defaultValue={profile.name}
              maxLength={160}
              required
            />
            <MantineTextInput
              label="Email address"
              type="email"
              autoComplete="email"
              value={profile.email}
              readOnly
            />
            <MantineTextInput
              name="phone"
              label="Mobile phone"
              autoComplete="tel"
              inputMode="tel"
              defaultValue={profile.phone ?? ""}
              maxLength={40}
              description="Use international format, for example +61400123456. Changes require reverification."
            />
            <MantineNativeSelect
              name="currentRegionId"
              label="Current region"
              defaultValue={profile.currentRegionId ?? ""}
              data={regionOptions}
            />
          </div>
          <div>
            <Title order={3}>Communication preferences</Title>
            <Text c="dimmed" size="sm" mt="xs">
              Choose which verified channels can be used for learner messages
              and secure access codes.
            </Text>
          </div>
          <div className={classes.preferenceList}>
            <label className={classes.preference}>
              <input
                type="checkbox"
                name="emailEnabled"
                defaultChecked={profile.emailEnabled}
              />
              <span className={classes.preferenceCopy}>
                <strong>Email enabled</strong>
                <Text component="span" c="dimmed" size="sm">
                  Receive learner communications and email access codes.
                </Text>
              </span>
            </label>
            <label className={classes.preference}>
              <input
                type="checkbox"
                name="smsEnabled"
                defaultChecked={profile.smsEnabled}
              />
              <span className={classes.preferenceCopy}>
                <strong>SMS enabled</strong>
                <Text component="span" c="dimmed" size="sm">
                  Receive SMS access codes at the mobile number above.
                </Text>
              </span>
            </label>
          </div>
          <div className={classes.formActions}>
            <Button type="submit" name="intent" value="update">
              Save profile
            </Button>
          </div>
        </Stack>
      </Paper>
    </form>
  );
}

function ContactVerification({
  profile,
  status,
}: {
  profile: LearnerProfile;
  status: string | undefined;
}) {
  return (
    <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
      <Stack gap="lg">
        <div>
          <Title order={2}>Contact verification</Title>
          <Text c="dimmed" size="sm" mt="xs">
            Verification is recommended for secure survey access and account
            recovery.
          </Text>
        </div>
        <div className={classes.verificationList}>
          <VerificationRow
            channel="email"
            label="Email"
            destination={profile.email}
            verified={profile.emailVerified}
            verifiedAt={profile.emailVerifiedAt}
            enteringCode={
              status === "email-code-sent" || status === "email-invalid"
            }
          />
          <VerificationRow
            channel="sms"
            label="Mobile phone"
            destination={profile.phone}
            verified={profile.smsVerifiedAt !== null}
            verifiedAt={profile.smsVerifiedAt}
            enteringCode={
              status === "sms-code-sent" || status === "sms-invalid"
            }
          />
        </div>
      </Stack>
    </Paper>
  );
}

function VerificationRow({
  channel,
  destination,
  enteringCode,
  label,
  verified,
  verifiedAt,
}: {
  channel: "email" | "sms";
  destination: string | null;
  enteringCode: boolean;
  label: string;
  verified: boolean;
  verifiedAt: string | null;
}) {
  return (
    <div className={classes.verificationRow}>
      <div className={classes.verificationIdentity}>
        <Group gap="sm">
          <Text fw={700}>{label}</Text>
          <Badge color={verified ? "green" : "gray"}>
            {verified ? "Verified" : "Unverified"}
          </Badge>
        </Group>
        <Text className={classes.verificationDestination}>
          {destination ?? "Not provided"}
        </Text>
        {verifiedAt ? (
          <Text c="dimmed" size="xs">
            Verified {new Date(verifiedAt).toLocaleDateString("en-AU")}
          </Text>
        ) : null}
      </div>
      {!verified && destination && !enteringCode ? (
        <form method="post">
          <input type="hidden" name="channel" value={channel} />
          <Button type="submit" name="intent" value="request" variant="light">
            Verify {channel === "email" ? "email" : "mobile"}
          </Button>
        </form>
      ) : null}
      {!verified && enteringCode ? (
        <form method="post" className={classes.codeForm}>
          <input type="hidden" name="channel" value={channel} />
          <MantineTextInput
            name="code"
            label="6-digit verification code"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            required
          />
          <Button type="submit" name="intent" value="verify">
            Verify code
          </Button>
        </form>
      ) : null}
      {!destination ? (
        <Text c="dimmed" size="sm">
          Add and save a mobile number before verification.
        </Text>
      ) : null}
    </div>
  );
}
