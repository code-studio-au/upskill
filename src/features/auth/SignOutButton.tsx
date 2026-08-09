import { Button } from "@mantine/core";
import { useState } from "react";
import { authClient } from "./auth-client";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut(): Promise<void> {
    setPending(true);
    try {
      const result = await authClient.signOut();
      if (!result.error) window.location.assign("/");
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
