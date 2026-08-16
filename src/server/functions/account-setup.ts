import { createServerFn } from "@tanstack/react-start";
import { accountSetupInputSchema } from "#/features/auth/account-setup.schema";

export const getAccountSetupRequest = createServerFn({ method: "POST" })
  .validator(accountSetupInputSchema)
  .handler(async ({ data }) => {
    const { findAccountSetupRequest } =
      await import("#/server/identity/account-setup.server");
    return await findAccountSetupRequest(data.token);
  });
