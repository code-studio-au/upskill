import {
  createFileRoute,
  Link,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  type AdminEmailDesignSummary,
  type EmailDesignContext,
} from "#/features/admin-email/admin-email.schema";
import classes from "#/features/admin-email/AdminEmailDesigner.module.css";
import { AppDialog } from "#/features/shared/AppDialog";
import { Badge } from "#/features/shared/Badge";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { PageTabs } from "#/features/shared/PageTabs";
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
  moveAdminEmailDesign,
} from "#/server/functions/admin-email";

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
          {designs.map((design, index) => (
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
              <div className={classes.catalogueOrder}>
                <button
                  aria-label="Up"
                  disabled={index === 0}
                  onClick={() => {
                    void move(design.id, "up");
                  }}
                >
                  ↑
                </button>
                <button
                  aria-label="Down"
                  disabled={index === designs.length - 1}
                  onClick={() => {
                    void move(design.id, "down");
                  }}
                >
                  ↓
                </button>
              </div>
            </Paper>
          ))}
        </div>
      )}
    </Stack>
  );
}

async function move(emailDesignId: string, direction: "down" | "up") {
  const result = await moveAdminEmailDesign({
    data: { emailDesignId, direction },
  }).catch(() => null);
  if (result) window.location.reload();
}

function AdminEmailsPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [catalogue, setCatalogue] = useState<"system" | "course" | "events">(
    "system",
  );
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [contextKey, setContextKey] =
    useState<EmailDesignContext>("offering_event");
  const create = async () => {
    setError(null);
    if (name.trim().length < 2) {
      setError("Enter an email name.");
      return;
    }
    setCreating(true);
    try {
      const created = await createAdminOfferingEmail({
        data: { name, contextKey },
      });
      if (created.status !== "ready") {
        setError("The email draft could not be created.");
        return;
      }
      await router.navigate({
        to: "/admin/emails/$emailDesignId",
        params: { emailDesignId: created.data.emailDesignId },
        search: { versionId: created.data.versionId },
      });
    } catch {
      setError("The email draft could not be created.");
    } finally {
      setCreating(false);
    }
  };
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
            setName("");
            setContextKey("offering_event");
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
        <AppDialog
          title="Create email"
          closeDisabled={creating}
          onClose={() => {
            if (!creating) setOpened(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Stack gap="md">
              <MantineTextInput
                label="Email name"
                value={name}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                required
              />
              <MantineNativeSelect
                label="Email type"
                value={contextKey}
                data={[
                  { value: "offering_event", label: "Event" },
                  { value: "offering_course", label: "Course" },
                ]}
                onChange={(event) => {
                  setContextKey(
                    event.currentTarget.value === "offering_course"
                      ? "offering_course"
                      : "offering_event",
                  );
                }}
                required
              />
              {error ? <Alert color="red">{error}</Alert> : null}
              <Group justify="flex-end">
                <Button
                  type="button"
                  variant="default"
                  disabled={creating}
                  onClick={() => {
                    setOpened(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={creating}>
                  Create draft
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      ) : null}
    </Stack>
  );
}
