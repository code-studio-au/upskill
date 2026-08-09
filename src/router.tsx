import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function clientNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const nonceMeta = document.querySelector<HTMLMetaElement>(
    'meta[property="csp-nonce"]',
  );

  return nonceMeta?.nonce || nonceMeta?.content || undefined;
}

export function getRouter() {
  const nonce = clientNonce();
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
