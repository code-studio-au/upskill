import { Button } from "#/features/shared/mantine";

import { useState } from "react";

export function SignOutButton({
  className,
}: {
  className?: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signOut(): Promise<void> {
    setPending(true);
    setMessage(null);
    try {
      const { hasOfflineScormCourseIndexRecords } =
        await import("#/features/scorm/offline-scorm-course-index-database");
      if (await hasOfflineScormCourseIndexRecords()) {
        setMessage(
          "Remove every offline course on this device before signing out. This protects downloaded content and unsynchronised progress.",
        );
        return;
      }
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.ok) location.href = "/";
      else setMessage("Sign-out failed. Please try again.");
    } catch {
      setMessage(
        "Offline learning storage could not be checked, so sign-out is blocked. Reopen the app and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        variant="default"
        size="sm"
        className={className}
        loading={pending}
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </Button>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
