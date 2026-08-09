import { createServerFn } from "@tanstack/react-start";
import { accessCodeInputSchema } from "#/features/access/access-code.schema";
import { learnerWorkspaceInputSchema } from "#/features/learning/learning.schema";

export const getLearnerDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return null;

    const { findLearnerDashboard } =
      await import("#/server/learner/learner.server");
    return await findLearnerDashboard(user);
  },
);

export const redeemLearnerAccessCode = createServerFn({ method: "POST" })
  .validator(accessCodeInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { redeemAccessCode } =
      await import("#/server/access/redeem-access-code.server");
    return await redeemAccessCode(data.code, user);
  });

export const getLearnerWorkspace = createServerFn({ method: "GET" })
  .validator(learnerWorkspaceInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { findLearnerWorkspace } =
      await import("#/server/learning/learner-workspace.server");
    return await findLearnerWorkspace(data.enrollmentId, user);
  });
