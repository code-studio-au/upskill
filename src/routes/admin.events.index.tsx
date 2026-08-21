import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/events/")({
  beforeLoad: () => {
    throw redirect({
      to: "/admin/events/scheduled",
      search: { view: "upcoming" },
    });
  },
});
