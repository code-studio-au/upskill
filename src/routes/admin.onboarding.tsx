import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import { Badge } from "#/features/shared/Badge";
import { Alert, Button } from "#/features/shared/mantine";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { type AdminOnboardingData } from "#/features/onboarding/onboarding.schema";
import {
  activateAdminOnboarding,
  getAdminOnboarding,
} from "#/server/functions/onboarding";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
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
  return <AdminOnboardingWorkspace data={result.data} />;
}

function AdminOnboardingWorkspace({ data }: { data: AdminOnboardingData }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { active, surveyVersions } = data;
  const [editing, setEditing] = useState(active === null);
  const initialSurveyVersionId =
    active?.surveyVersionId ?? surveyVersions[0]?.id ?? "";
  const [form, setForm] = useState(() => ({
    surveyVersionId: initialSurveyVersionId,
    privacyNotice: active?.privacyNotice ?? "",
    privacyNoticeVersion: active?.privacyNoticeVersion ?? "1",
    contactVerificationRequired: active?.contactVerificationRequired ?? false,
  }));
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
        <h1>User onboarding</h1>
        <div>
          {active ? (
            <Badge color="green">Published v{active.version}</Badge>
          ) : (
            <strong>Not published</strong>
          )}
          {active && !editing ? (
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              Create new version
            </Button>
          ) : null}
        </div>
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
            <h2>Onboarding settings</h2>
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
            <label>
              <input
                type="checkbox"
                checked={form.contactVerificationRequired}
                disabled={!editing}
                onChange={(event) => {
                  updateForm(
                    "contactVerificationRequired",
                    event.currentTarget.checked,
                  );
                }}
              />
              Require enabled contacts to be verified
            </label>
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
