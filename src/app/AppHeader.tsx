import { Button, Container } from "#/features/shared/mantine";
import { Link, useRouterState } from "@tanstack/react-router";
import type { AppShellSession } from "#/server/functions/app-shell";
import { SignOutButton } from "#/features/auth/SignOutButton";
import classes from "./AppShell.module.css";

type NavigationTarget =
  | "/access-management"
  | "/admin"
  | "/dashboard"
  | "/event-operations"
  | "/my-events"
  | "/onboarding";

interface NavigationItem {
  label: string;
  to: NavigationTarget;
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("en-AU") ?? "")
    .join("");
}

export function AppHeader({ session }: { session: AppShellSession }) {
  const user = session.user;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigationItems: Array<NavigationItem> = [];

  if (user?.requiresOnboarding)
    navigationItems.push({ label: "Complete onboarding", to: "/onboarding" });
  if (user && !user.requiresOnboarding) {
    navigationItems.push({ label: "My learning", to: "/dashboard" });
    navigationItems.push({ label: "My events", to: "/my-events" });
  }
  if (user?.isPlatformAdministrator)
    navigationItems.push({ label: "Administration", to: "/admin" });
  if (user?.hasAssignedEventOperations)
    navigationItems.push({
      label: "Event operations",
      to: "/event-operations",
    });
  if (user?.hasAccessOwnerAssignments)
    navigationItems.push({
      label: "Access management",
      to: "/access-management",
    });

  return (
    <header className={classes.header}>
      <Container size="xl" className={classes.headerInner}>
        <Link to="/" className={classes.brand} aria-label="Upskill home">
          <img
            src="/brand/upskill-icon-navy.png"
            alt=""
            width="128"
            height="128"
            className={classes.brandIcon}
          />
          <img
            src="/brand/upskill-wordmark-navy.png"
            alt="Upskill Institute"
            width="480"
            height="91"
            className={classes.brandWordmark}
          />
        </Link>

        <nav className={classes.desktopNav} aria-label="Primary navigation">
          {navigationItems.map((item) => (
            <Link to={item.to} className={classes.headerLink} key={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>

        {user ? (
          <details className={classes.accountMenu} key={`account-${pathname}`}>
            <summary
              className={classes.accountTrigger}
              aria-label={`${user.name} account menu`}
            >
              <span className={classes.avatar} aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className={classes.accountName}>{user.name}</span>
              <span className={classes.chevron} aria-hidden="true">
                ▾
              </span>
            </summary>
            <div className={classes.accountPopover}>
              <div className={classes.accountIdentity}>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <SignOutButton className={classes.signOut} />
            </div>
          </details>
        ) : (
          <Button
            component={Link}
            to="/login"
            size="sm"
            className={classes.signInAction}
          >
            Sign in
          </Button>
        )}

        {user ? (
          <details
            className={classes.mobileMenu}
            key={`navigation-${pathname}`}
          >
            <summary
              className={classes.mobileMenuTrigger}
              aria-label="Navigation menu"
            >
              <img
                src="/icons/menu-navy.svg"
                alt=""
                width="32"
                height="32"
                className={classes.menuOpenIcon}
              />
              <img
                src="/icons/close-navy.svg"
                alt=""
                width="32"
                height="32"
                className={classes.menuCloseIcon}
              />
            </summary>
            <div className={classes.mobileMenuPanel}>
              <div className={classes.mobileIdentity}>
                <span className={classes.avatar} aria-hidden="true">
                  {initials(user.name)}
                </span>
                <span className={classes.mobileIdentityCopy}>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </span>
              </div>
              <nav className={classes.mobileNav} aria-label="Mobile navigation">
                {navigationItems.map((item) => (
                  <Link to={item.to} className={classes.menuLink} key={item.to}>
                    {item.label}
                    <span aria-hidden="true">→</span>
                  </Link>
                ))}
              </nav>
              <SignOutButton className={classes.mobileSignOut} />
            </div>
          </details>
        ) : null}
      </Container>
    </header>
  );
}
