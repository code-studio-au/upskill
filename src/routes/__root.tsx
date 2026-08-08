import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "#/styles/global.css";

import { Button, Container, Group, Text, Title } from "@mantine/core";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { AppProviders } from "#/app/AppProviders";
import classes from "#/app/AppShell.module.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Upskill learning" },
      {
        name: "description",
        content: "Discover practical courses, events and learning programs.",
      },
    ],
  }),
  component: RootOutlet,
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppProviders>
          <header className={classes.header}>
            <Container size="lg" className={classes.headerInner}>
              <Link to="/" className={classes.brand} aria-label="Upskill home">
                Upskill
              </Link>
              <nav className={classes.nav} aria-label="Primary navigation">
                <Button component={Link} to="/courses" variant="subtle">
                  Courses
                </Button>
                <Button
                  component={Link}
                  to="/dashboard"
                  variant="subtle"
                  className={classes.dashboardLink}
                >
                  My learning
                </Button>
              </nav>
            </Container>
          </header>
          <main className={classes.main}>{children}</main>
          <footer className={classes.footer}>
            <Container size="lg">
              <Group justify="space-between">
                <Text size="sm">Upskill learning platform</Text>
                <Text size="sm" c="dimmed">
                  Secure by default
                </Text>
              </Group>
            </Container>
          </footer>
        </AppProviders>
        <Scripts />
      </body>
    </html>
  );
}

function RootOutlet() {
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <Container size="sm" py={{ base: 64, sm: 96 }}>
      <Text c="indigo.7" fw={700}>
        404
      </Text>
      <Title order={1}>That page is not here</Title>
      <Text c="dimmed" mt="md">
        The address may have changed, or the content may no longer be available.
      </Text>
      <Button component={Link} to="/courses" mt="xl">
        Browse courses
      </Button>
    </Container>
  );
}
