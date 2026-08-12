import "@mantine/core/styles/baseline.css";
import "@mantine/core/styles/default-css-variables.css";
import "@mantine/core/styles/global.css";
import "@mantine/core/styles/Button.css";
import "@mantine/core/styles/Loader.css";
import "#/styles/global.css";

import { Container, Group, Text } from "#/features/shared/mantine";
import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { AppProviders } from "#/app/AppProviders";
import { AppHeader } from "#/app/AppHeader";
import classes from "#/app/AppShell.module.css";
import { NotFoundPage } from "#/app/NotFoundPage";
import { RootOutlet } from "#/app/RootOutlet";
import { getAppShellSession } from "#/server/functions/app-shell";

export const Route = createRootRoute({
  loader: () => getAppShellSession(),
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
  const session = Route.useLoaderData();
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
          <AppHeader session={session} />
          <main className={classes.main}>{children}</main>
          <footer className={classes.footer}>
            <Container size="xl">
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
