import { describe, expect, it } from "vitest";
import { learnerWorkspaceInputSchema } from "./learning.schema";

describe("learner workspace input", () => {
  it.each(["enrollment_123", "4cb3a714-c941-43e9-a973-e75255cddef0"])(
    "accepts an internal enrollment identifier %s",
    (enrollmentId) => {
      expect(learnerWorkspaceInputSchema.parse({ enrollmentId })).toEqual({
        enrollmentId,
      });
    },
  );

  it.each(["", "../another-user", "enrollment?redirect=/admin"])(
    "rejects an invalid enrollment identifier %s",
    (enrollmentId) => {
      expect(() =>
        learnerWorkspaceInputSchema.parse({ enrollmentId }),
      ).toThrow();
    },
  );
});
