import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { type AdminOnboardingData } from "#/features/onboarding/onboarding.schema";
import {
  activateAdminOnboarding,
  getAdminOnboarding,
} from "#/server/functions/onboarding";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import classes from "./admin.onboarding.module.css";

export const Route = createFileRoute("/admin/onboarding")({
  ssr: false,
  loader: async () => {
    const result = await getAdminOnboarding();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/onboarding" },
      });
    return result;
  },
  component: AdminOnboardingPage,
});

function AdminOnboardingPage() {
  const result = Route.useLoaderData();
  if (result.status === "forbidden") return <AdminAccessDenied />;
  return (
    <AdminOnboardingWorkspace
      key={result.data.active?.id ?? "not-configured"}
      data={result.data}
    />
  );
}

function AdminOnboardingWorkspace({ data }: { data: AdminOnboardingData }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { active, surveyVersions, versions } = data;
  const [selectedId, setSelectedId] = useState(
    active?.id ?? versions[0]?.id ?? "",
  );
  const selected =
    versions.find((configuration) => configuration.id === selectedId) ?? null;
  const [editing, setEditing] = useState(versions.length === 0);
  const initialSurveyVersionId =
    selected?.surveyVersionId ?? surveyVersions[0]?.id ?? "";
  const [form, setForm] = useState(() => ({
    surveyVersionId: initialSurveyVersionId,
    privacyNotice: selected?.privacyNotice ?? "",
    privacyNoticeVersion: selected?.privacyNoticeVersion ?? "1",
    contactVerificationRequired: selected?.contactVerificationRequired ?? false,
  }));
  const selectConfiguration = (configurationId: string) => {
    const configuration = versions.find(
      (candidate) => candidate.id === configurationId,
    );
    if (!configuration) return;
    setSelectedId(configuration.id);
    setEditing(false);
    setForm({
      surveyVersionId: configuration.surveyVersionId,
      privacyNotice: configuration.privacyNotice,
      privacyNoticeVersion: configuration.privacyNoticeVersion,
      contactVerificationRequired: configuration.contactVerificationRequired,
    });
  };
  const updateForm = <Key extends keyof typeof form>(
    key: Key,
    value: (typeof form)[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const activate = async () => {
    setError(undefined);
    setSubmitting(true);
    try {
      const response = await activateAdminOnboarding({ data: form });
      if (response.status !== "ready") {
        setError(
          response.status === "invalid"
            ? response.message
            : "Onboarding could not be activated.",
        );
        return;
      }
      setEditing(false);
      await router.invalidate();
    } catch {
      setError("Onboarding could not be activated.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className={classes.page}>
      <header>
        <div>
          <Text c="indigo.7" fw={700}>
            Workspace
          </Text>
          <Title order={1}>User onboarding</Title>
        </div>
        <Group>
          {selected ? (
            <Badge color={selected.id === active?.id ? "green" : "gray"}>
              {selected.id === active?.id ? "Active" : "Historical"} v
              {selected.version}
            </Badge>
          ) : (
            <strong>Not published</strong>
          )}
          {selected && !editing ? (
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              Create new version from v{selected.version}
            </Button>
          ) : null}
        </Group>
      </header>
      {surveyVersions.length === 0 ? (
        <Alert title="No surveys">
          Publish a User onboarding survey first.
        </Alert>
      ) : (
        <section>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void activate();
            }}
          >
            <Title order={2}>Onboarding settings</Title>
            {versions.length > 0 ? (
              <MantineNativeSelect
                label="Onboarding version"
                value={selected?.id ?? ""}
                data={versions.map((configuration) => ({
                  value: configuration.id,
                  label: `Version ${String(configuration.version)}${configuration.id === active?.id ? " · Active" : " · Historical"}`,
                }))}
                disabled={editing}
                onChange={(event) => {
                  selectConfiguration(event.currentTarget.value);
                }}
              />
            ) : null}
            {selected && !editing ? (
              <Text c="dimmed" size="sm">
                Activated {formatLocalDateTime(selected.activatedAt)}
                {selected.deactivatedAt
                  ? ` · Replaced ${formatLocalDateTime(selected.deactivatedAt)}`
                  : " · Current active configuration"}
              </Text>
            ) : null}
            <MantineNativeSelect
              label="Onboarding survey"
              value={form.surveyVersionId}
              data={surveyVersions.map((survey) => ({
                value: survey.id,
                label: `${survey.title} — version ${String(survey.version)}`,
              }))}
              onChange={(event) => {
                const surveyVersionId = event.currentTarget.value;
                setForm((current) => ({
                  ...current,
                  surveyVersionId,
                }));
              }}
              disabled={!editing}
              required
            />
            {selected && !editing ? (
              <Link
                to="/admin/surveys/$surveyId"
                params={{ surveyId: selected.surveyId }}
                search={{ version: selected.surveyVersionId }}
                className={classes.surveyLink}
              >
                <Button component="span" variant="light">
                  Open pinned survey version {selected.surveyVersion}
                </Button>
              </Link>
            ) : null}
            <MantineTextInput
              label="Privacy notice version"
              value={form.privacyNoticeVersion}
              onChange={(event) => {
                updateForm("privacyNoticeVersion", event.currentTarget.value);
              }}
              disabled={!editing}
              required
            />
            <MantineTextInput
              component="textarea"
              label="Privacy notice"
              value={form.privacyNotice}
              onChange={(event) => {
                updateForm("privacyNotice", event.currentTarget.value);
              }}
              disabled={!editing}
              required
            />
            <MantineCheckbox
              label="Require enabled contacts to be verified"
              checked={form.contactVerificationRequired}
              disabled={!editing}
              onChange={(checked) => {
                updateForm("contactVerificationRequired", checked);
              }}
            />
            {selected && !editing ? (
              <Stack gap="xs">
                <Title order={3} size="h4">
                  Profile mappings
                </Title>
                {selected.mappingDetails.length > 0 ? (
                  <dl className={classes.mappingList}>
                    {selected.mappingDetails.map((mapping) => (
                      <div key={mapping.destination}>
                        <dt>{mapping.destination}</dt>
                        <dd>
                          {mapping.prompt} · {mapping.questionType}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <Text c="dimmed" size="sm">
                    No profile fields were mapped in this version.
                  </Text>
                )}
              </Stack>
            ) : null}
            {error ? <Alert color="red">{error}</Alert> : null}
            {editing ? (
              <Button type="submit" loading={submitting}>
                Publish version
              </Button>
            ) : null}
          </form>
        </section>
      )}
    </main>
  );
}
