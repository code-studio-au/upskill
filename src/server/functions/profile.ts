import { createServerFn } from "@tanstack/react-start";
import type { LearnerProfileResult } from "#/features/profile/learner-profile.schema";

export const getLearnerProfile = createServerFn({ method: "GET" }).handler(
  async (): Promise<LearnerProfileResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findLearnerProfile } =
      await import("#/server/profile/learner-profile.server");
    return { status: "ready", data: await findLearnerProfile(user) };
  },
);
