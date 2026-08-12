import { Link, useRouterState } from "@tanstack/react-router";
import classes from "./AdminNavigation.module.css";

interface NavigationItem {
  label: string;
  to:
    | "/admin"
    | "/admin/learners"
    | "/admin/courses"
    | "/admin/events"
    | "/admin/modules"
    | "/admin/surveys"
    | "/admin/resources"
    | "/admin/access";
}

const groups: Array<{ label: string; items: Array<NavigationItem> }> = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", to: "/admin" },
      { label: "Learners", to: "/admin/learners" },
      { label: "Events", to: "/admin/events" },
      { label: "Access grants", to: "/admin/access" },
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
