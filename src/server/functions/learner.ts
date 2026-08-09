import { createServerFn } from "@tanstack/react-start";

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
