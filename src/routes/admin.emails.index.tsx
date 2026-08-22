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
import { PageTabs } from "#/features/shared/PageTabs";
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

function EmailCatalogue({
  designs,
  empty,
}: {
  designs: Array<AdminEmailDesignSummary>;
  empty: string;
}) {
  return (
    <Stack gap="md">
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
              <Group justify="space-between" align="start" wrap="nowrap">
                <Link
                  to="/admin/emails/$emailDesignId"
                  params={{ emailDesignId: design.id }}
                  search={{ versionId: undefined }}
                  className={classes.cardTitleLink}
                >
                  <Title order={3} size="h3">
                    {design.name}
                  </Title>
                </Link>
                <Group gap="xs" wrap="wrap" justify="flex-end">
                  {design.activeVersion ? (
                    <Badge color="green">Active v{design.activeVersion}</Badge>
                  ) : (
                    <Badge color="gray">Not published</Badge>
                  )}
                  {design.draftVersion ? (
                    <Badge color="gray">Draft v{design.draftVersion}</Badge>
                  ) : null}
                </Group>
              </Group>
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
  const [catalogue, setCatalogue] = useState<"system" | "course" | "events">(
    "system",
  );
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
  const courseEmails = result.data.filter(
    (design) => design.contextKey === "offering_course",
  );
  const eventEmails = result.data.filter(
    (design) => design.contextKey === "offering_event",
  );
  const visibleEmails =
    catalogue === "system"
      ? systemEmails
      : catalogue === "course"
        ? courseEmails
        : eventEmails;

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
          Create email
        </Button>
      </Group>

      <PageTabs
        label="Email catalogue"
        value={catalogue}
        tabs={[
          {
            value: "system",
            label: `System (${String(systemEmails.length)})`,
          },
          {
            value: "course",
            label: `Course (${String(courseEmails.length)})`,
          },
          {
            value: "events",
            label: `Events (${String(eventEmails.length)})`,
          },
        ]}
        onChange={setCatalogue}
      />
      <EmailCatalogue
        designs={visibleEmails}
        empty={`No ${catalogue} emails yet.`}
      />

      {opened ? (
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <AppDialog
              title="Create email"
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
                        label="Email type"
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
