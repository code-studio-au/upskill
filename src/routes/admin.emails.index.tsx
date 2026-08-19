import { useForm } from "@tanstack/react-form";
import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  adminEmailDesignCreateSchema,
  type AdminEmailDesignSummary,
  type EmailDesignContext,
} from "#/features/admin-email/admin-email.schema";
import classes from "#/features/admin-email/AdminEmailDesigner.module.css";
import { AppDialog } from "#/features/shared/AppDialog";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  createAdminOfferingEmail,
  getAdminEmailDesigns,
} from "#/server/functions/admin-email";

interface CreateValues {
  name: string;
  contextKey: EmailDesignContext;
}

const defaultValues: CreateValues = {
  name: "",
  contextKey: "offering_event",
};

export const Route = createFileRoute("/admin/emails/")({
  ssr: false,
  loader: async () => {
    const result = await getAdminEmailDesigns();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/emails" },
      });
    return result;
  },
  component: AdminEmailsPage,
});

function contextLabel(contextKey: string): string {
  if (contextKey === "system_account_setup") return "Account setup";
  if (contextKey === "offering_course") return "Course";
  return "Event";
}

function EmailCatalogue({
  designs,
  empty,
  title,
}: {
  designs: Array<AdminEmailDesignSummary>;
  empty: string;
  title: string;
}) {
  return (
    <Stack gap="md">
      <Title order={2}>{title}</Title>
      {designs.length === 0 ? (
        <Alert>{empty}</Alert>
      ) : (
        <div className={classes.catalogueGrid}>
          {designs.map((design) => (
            <Paper
              component="article"
              key={design.id}
              withBorder
              radius="lg"
              p="md"
              className={classes.card}
            >
              <div className={classes.cardHeader}>
                <Title order={3} size="h3">
                  {design.name}
                </Title>
                <Badge variant="outline">
                  {contextLabel(design.contextKey)}
                </Badge>
              </div>
              <Group gap="sm">
                {design.activeVersion ? (
                  <Badge color="green">Active v{design.activeVersion}</Badge>
                ) : (
                  <Badge color="gray">Not published</Badge>
                )}
                {design.draftVersion ? (
                  <Badge>Draft v{design.draftVersion}</Badge>
                ) : null}
              </Group>
              <Link
                to="/admin/emails/$emailDesignId"
                params={{ emailDesignId: design.id }}
                search={{ versionId: undefined }}
              >
                <Button component="span" variant="light">
                  Open email
                </Button>
              </Link>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}

function AdminEmailsPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues,
    validators: { onSubmit: adminEmailDesignCreateSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const created = await createAdminOfferingEmail({ data: value });
      if (created.status !== "ready") {
        setError("The email draft could not be created.");
        return;
      }
      await router.navigate({
        to: "/admin/emails/$emailDesignId",
        params: { emailDesignId: created.data.emailDesignId },
        search: { versionId: created.data.versionId },
      });
    },
  });
  if (result.status === "forbidden") return <AdminAccessDenied />;

  const systemEmails = result.data.filter(
    (design) => design.catalogue === "system",
  );
  const offeringEmails = result.data.filter(
    (design) => design.catalogue === "offering",
  );

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end">
        <div>
          <Text c="indigo.7" fw={700}>
            Communications
          </Text>
          <Title order={1}>Email designer</Title>
        </div>
        <Button
          onClick={() => {
            form.reset();
            setError(null);
            setOpened(true);
          }}
        >
          Create offering email
        </Button>
      </Group>

      <EmailCatalogue
        title="System emails"
        designs={systemEmails}
        empty="No system emails available."
      />
      <EmailCatalogue
        title="Offering emails"
        designs={offeringEmails}
        empty="No offering emails yet."
      />

      {opened ? (
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <AppDialog
              title="Create offering email"
              closeDisabled={isSubmitting}
              onClose={() => {
                if (!isSubmitting) setOpened(false);
              }}
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <Stack gap="md">
                  <form.Field name="name">
                    {(field) => (
                      <MantineTextInput
                        label="Email name"
                        value={field.state.value}
                        error={firstFormError(field.state.meta.errors)}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        required
                      />
                    )}
                  </form.Field>
                  <form.Field name="contextKey">
                    {(field) => (
                      <MantineNativeSelect
                        label="Offering type"
                        value={field.state.value}
                        data={[
                          { value: "offering_event", label: "Event" },
                          { value: "offering_course", label: "Course" },
                        ]}
                        onChange={(event) => {
                          field.handleChange(
                            event.currentTarget.value === "offering_course"
                              ? "offering_course"
                              : "offering_event",
                          );
                        }}
                        required
                      />
                    )}
                  </form.Field>
                  {error ? <Alert color="red">{error}</Alert> : null}
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      variant="default"
                      disabled={isSubmitting}
                      onClick={() => {
                        setOpened(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" loading={isSubmitting}>
                      Create draft
                    </Button>
                  </Group>
                </Stack>
              </form>
            </AppDialog>
          )}
        </form.Subscribe>
      ) : null}
    </Stack>
  );
}
