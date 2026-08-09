import { createTheme, MantineProvider } from "@mantine/core";
import { useHydrated, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

const theme = createTheme({
  primaryColor: "indigo",
  primaryShade: 7,
  colors: {
    gray: [
      "#f8f9fa",
      "#f1f3f5",
      "#e9ecef",
      "#dee2e6",
      "#ced4da",
      "#adb5bd",
      "#5c636a",
      "#495057",
      "#343a40",
      "#212529",
    ],
  },
  defaultRadius: "md",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  headings: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" },
});

export function AppProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const nonce = router.options.ssr?.nonce;
  const hydrated = useHydrated();
  const styleNonce =
    typeof document === "undefined" || hydrated ? (nonce ?? "") : "";

  return (
    <MantineProvider theme={theme} getStyleNonce={() => styleNonce}>
      {children}
    </MantineProvider>
  );
}
