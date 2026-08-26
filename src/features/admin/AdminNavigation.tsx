import { Link, useRouterState } from "@tanstack/react-router";
import classes from "./AdminNavigation.module.css";

interface NavigationItem {
  label: string;
  to:
    | "/admin"
    | "/admin/learners"
    | "/admin/administrators"
    | "/admin/courses"
    | "/admin/events/templates"
    | "/admin/events/scheduled"
    | "/admin/events/settings"
    | "/admin/modules"
    | "/admin/surveys"
    | "/admin/resources"
    | "/admin/access"
    | "/admin/emails"
    | "/admin/notifications"
    | "/admin/onboarding";
}

const groups: Array<{ label: string; items: Array<NavigationItem> }> = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", to: "/admin" },
      { label: "Learners", to: "/admin/learners" },
      { label: "Administrators", to: "/admin/administrators" },
      { label: "Access grants", to: "/admin/access" },
      { label: "User onboarding", to: "/admin/onboarding" },
    ],
  },
  {
    label: "Events",
    items: [
      { label: "Event templates", to: "/admin/events/templates" },
      { label: "Scheduled events", to: "/admin/events/scheduled" },
      { label: "Event settings", to: "/admin/events/settings" },
    ],
  },
  {
    label: "Communications",
    items: [
      { label: "Email designer", to: "/admin/emails" },
      { label: "Delivery operations", to: "/admin/notifications" },
    ],
  },
  {
    label: "Learning content",
    items: [
      { label: "Courses", to: "/admin/courses" },
      { label: "SCORM modules", to: "/admin/modules" },
      { label: "Surveys", to: "/admin/surveys" },
      {
        label: "PDF resources",
        to: "/admin/resources",
      },
    ],
  },
];

function isActive(pathname: string, to: NavigationItem["to"]): boolean {
  if (to === "/admin/events/templates") {
    if (pathname === to) return true;
    const eventChild = pathname.slice("/admin/events/".length).split("/")[0];
    return (
      pathname.startsWith("/admin/events/") &&
      !["instances", "scheduled", "settings", "templates"].includes(
        eventChild ?? "",
      )
    );
  }
  if (to === "/admin/events/scheduled") {
    return pathname === to || pathname.startsWith("/admin/events/instances/");
  }
  return to === "/admin"
    ? pathname === "/admin" || pathname === "/admin/"
    : pathname === to || pathname.startsWith(`${to}/`);
}

function NavigationLinks({ pathname }: { pathname: string }) {
  return groups.map((group) => (
    <div className={classes.group} key={group.label}>
      <span className={classes.groupLabel}>{group.label}</span>
      <div className={classes.links}>
        {group.items.map((item) => {
          const active = isActive(pathname, item.to);
          return (
            <Link
              className={classes.link}
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
              key={item.to}
              to={item.to}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  ));
}

export function AdminNavigation() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const current = groups
    .flatMap((group) => group.items)
    .find((item) => isActive(pathname, item.to));
  return (
    <>
      <aside className={classes.desktop} aria-label="Administration navigation">
        <div className={classes.heading}>
          <span className={classes.eyebrow}>Administration</span>
          <strong>Workspace</strong>
        </div>
        <NavigationLinks pathname={pathname} />
      </aside>
      <details
        className={classes.mobile}
        key={pathname}
        aria-label="Administration menu"
      >
        <summary>
          <span>
            <small>Administration</small>
            <strong>{current?.label ?? "Menu"}</strong>
          </span>
          <span className={classes.chevron} aria-hidden="true">
            ▾
          </span>
        </summary>
        <nav aria-label="Administration navigation">
          <NavigationLinks pathname={pathname} />
        </nav>
      </details>
    </>
  );
}
