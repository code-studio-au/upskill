import { Button } from "#/features/shared/mantine";
import { OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME } from "#/features/scorm/offline-scorm-course-index-database";

import { useState } from "react";

export function SignOutButton({
  className,
}: {
  className?: string | undefined;
}) {
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    try {
      if (
        !(await indexedDB.databases()).some(
          (database) =>
            database.name === OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME,
        ) &&
        (
          await fetch("/api/auth/sign-out", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).ok
      )
        location.href = "/";
      else throw new Error();
    } catch {
      window.alert("Sign-out blocked. Remove offline courses, then retry.");
    } finally {
      setPending(false);
    }
  }

  return (
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
  );
}
