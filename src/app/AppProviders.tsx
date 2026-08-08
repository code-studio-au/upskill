import { createTheme, MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  headings: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
});

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const nonce = router.options.ssr?.nonce;

  return (
    <MantineProvider theme={theme} getStyleNonce={() => nonce ?? ""}>
      <Notifications />
      {children}
    </MantineProvider>
  );
}
