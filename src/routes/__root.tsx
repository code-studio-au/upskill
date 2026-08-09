import "@mantine/core/styles.css";
import "#/styles/global.css";

import { Button, Container, Group, Text } from "@mantine/core";
import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { AppProviders } from "#/app/AppProviders";
import classes from "#/app/AppShell.module.css";
import { NotFoundPage } from "#/app/NotFoundPage";
import { RootOutlet } from "#/app/RootOutlet";

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
    links: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
  }),
  component: RootOutlet,
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const nonce = router.options.ssr?.nonce;

  return (
    <html lang="en-AU" data-mantine-color-scheme="light">
      <head>
        {nonce ? (
          <meta property="csp-nonce" content={nonce} nonce={nonce} />
        ) : null}
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
