import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/server/auth/auth.server";
import { offlineScormSignOutGate } from "#/server/auth/sign-out.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) =>
        (await offlineScormSignOutGate(request)) ?? auth.handler(request),
    },
  },
});
