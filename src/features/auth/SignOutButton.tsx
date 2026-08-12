import { Button } from "#/features/shared/mantine";

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
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.ok) location.href = "/";
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
