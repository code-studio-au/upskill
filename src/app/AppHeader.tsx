import { Button, Container } from "#/features/shared/mantine";
import { Link, useRouterState } from "@tanstack/react-router";
import type { AppShellSession } from "#/server/functions/app-shell";
import { SignOutButton } from "#/features/auth/SignOutButton";
import classes from "./AppShell.module.css";

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
  return (
    <header className={classes.header}>
      <Container size="xl" className={classes.headerInner}>
        <Link to="/" className={classes.brand} aria-label="Upskill home">
          <span className={classes.brandMark} aria-hidden="true">
            U
          </span>
          <span>Upskill</span>
        </Link>

        <nav
          className={classes.desktopNav}
          aria-label="Primary navigation"
          data-authenticated={Boolean(user)}
        >
          <Link
            to="/courses"
            search={{ q: "", topic: "all", page: 1 }}
            className={classes.headerLink}
          >
            Browse learning
          </Link>
          {user ? (
            <Link to="/dashboard" className={classes.headerLink}>
              My learning
            </Link>
          ) : null}
          {user?.isPlatformAdministrator ? (
            <Link to="/admin" className={classes.headerLink}>
              Administration
            </Link>
          ) : null}
          {user?.hasAssignedEventOperations ? (
            <Link to="/event-operations" className={classes.headerLink}>
              Event operations
            </Link>
          ) : null}
        </nav>

        {user ? (
          <details className={classes.accountMenu} key={pathname}>
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
              <div className={classes.mobileAccountLinks}>
                <Link
                  to="/courses"
                  search={{ q: "", topic: "all", page: 1 }}
                  className={classes.menuLink}
                >
                  Browse learning
                </Link>
                <Link to="/dashboard" className={classes.menuLink}>
                  My learning
                </Link>
                {user.isPlatformAdministrator ? (
                  <Link to="/admin" className={classes.menuLink}>
                    Administration
                  </Link>
                ) : null}
                {user.hasAssignedEventOperations ? (
                  <Link to="/event-operations" className={classes.menuLink}>
                    Event operations
                  </Link>
                ) : null}
              </div>
              <SignOutButton className={classes.signOut} />
            </div>
          </details>
        ) : (
          <Button component={Link} to="/login" size="sm">
            Sign in
          </Button>
        )}
      </Container>
    </header>
  );
}
