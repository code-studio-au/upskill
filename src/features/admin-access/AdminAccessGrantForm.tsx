import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { firstFormError } from "#/features/shared/form-errors";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { createAdminAccessGrant } from "#/server/functions/admin-access-grant";
import {
  adminAccessGrantCreateSchema,
  type AdminAccessGrantDirectory,
} from "./admin-access.schema";
import classes from "./AdminAccessGrantManager.module.css";

export function AdminAccessGrantForm({
  targets,
  onDone,
}: {
  targets: AdminAccessGrantDirectory["targets"];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const targetOptions = useMemo(
    () =>
      targets.map((target) => ({
        value: target.courseVersionId,
        label: `${target.courseTitle} · Version ${String(target.version)}`,
      })),
    [targets],
  );
  const grantForm = useForm({
    defaultValues: {
      label: "",
      organizationName: "",
      accessCode: "",
      courseVersionId: targets[0]?.courseVersionId ?? "",
      quantity: 10,
      enrollmentDurationDays: 365,
      expiresOn: "",
      domains: "",
    },
    validators: { onSubmit: adminAccessGrantCreateSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setMessage(null);
      setIssuedCode(null);
      const response = await createAdminAccessGrant({ data: value });
      if (response.status === "not-found") {
        setError("Choose a published course version that is still available.");
        return;
      }
      if (response.status === "conflict") {
        setError("The access-code expiry must be in the future.");
        return;
      }
      if (response.status !== "ready" || !response.data.accessCode) {
        setError(
          "The access grant could not be created. Refresh and try again.",
        );
        return;
      }
      setIssuedCode(response.data.accessCode);
      setCopyState("idle");
      setMessage(
        "Access grant created. Administrators can retrieve this code again later.",
      );
      grantForm.reset();
      await router.invalidate();
    },
  });
  const canCreate = targets.length > 0;

  async function copyIssuedCode(): Promise<void> {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Stack gap="md">
      {message ? (
        <Alert color="green" role="status">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}
      {issuedCode ? (
        <Alert color="gray" title="Access code created" role="status">
          <Stack gap="sm">
            <Text>
              Share this code with the organisation. It remains retrievable from
              the grant card by platform administrators.
            </Text>
            <code className={classes.issuedCode}>{issuedCode}</code>
            <Group gap="sm">
              <Button
                type="button"
                variant="light"
                onClick={() => {
                  void copyIssuedCode();
                }}
              >
                {copyState === "copied" ? "Copied" : "Copy access code"}
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  onDone?.();
                }}
              >
                Done
              </Button>
            </Group>
            {copyState === "failed" ? (
              <Text size="sm">
                Copy was unavailable. Select the code and copy it manually.
              </Text>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void grantForm.handleSubmit();
        }}
      >
        <Stack gap="md">
          <Text c="dimmed" size="sm">
            Learners retain their enrolment if this code is later revoked.
          </Text>
          <div className={classes.formGrid}>
            <grantForm.Field name="label">
              {(field) => (
                <MantineTextInput
                  label="Grant label"
                  placeholder="2027 graduate intake"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="organizationName">
              {(field) => (
                <MantineTextInput
                  label="Organisation"
                  placeholder="Example Health"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="accessCode">
              {(field) => (
                <MantineTextInput
                  label="Access code"
                  description="Use a memorable organisation or cohort code. A short unique lookup suffix will be appended when the grant is created."
                  placeholder="EXAMPLE-HEALTH-2027"
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="courseVersionId">
              {(field) => (
                <MantineNativeSelect
                  label="Published course version"
                  data={targetOptions}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  disabled={!canCreate}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="quantity">
              {(field) => (
                <MantineTextInput
                  label="Available enrolments"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100_000}
                  value={String(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(Number(event.currentTarget.value));
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="enrollmentDurationDays">
              {(field) => (
                <MantineTextInput
                  label="Learner access duration (days)"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  value={String(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(Number(event.currentTarget.value));
                  }}
                  error={firstFormError(field.state.meta.errors)}
                  required
                />
              )}
            </grantForm.Field>
            <grantForm.Field name="expiresOn">
              {(field) => (
                <MantineTextInput
                  label="Code expiry date (optional, UTC)"
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value);
                  }}
                  error={firstFormError(field.state.meta.errors)}
                />
              )}
            </grantForm.Field>
          </div>
          <grantForm.Field name="domains">
            {(field) => (
              <MantineTextInput
                component="textarea"
                label="Permitted email domains (optional)"
                description="Separate domains with commas or new lines. Leave blank to allow any verified learner."
                placeholder="example.com, staff.example.org"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
                error={firstFormError(field.state.meta.errors)}
              />
            )}
          </grantForm.Field>
          {!canCreate ? (
            <Alert color="orange">
              Publish a course version before issuing access.
            </Alert>
          ) : null}
          <grantForm.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Group justify="flex-end">
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canCreate || isSubmitting}
                >
                  Create access grant
                </Button>
              </Group>
            )}
          </grantForm.Subscribe>
        </Stack>
      </form>
    </Stack>
  );
}
