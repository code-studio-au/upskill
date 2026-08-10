import { Button } from "@mantine/core";

import { useState } from "react";

export function SignOutButton() {
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
      loading={pending}
      onClick={() => {
        void signOut();
      }}
    >
      Sign out
    </Button>
  );
}
