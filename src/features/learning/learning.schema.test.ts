import { describe, expect, it } from "vitest";
import {
  learnerResourceInputSchema,
  learnerWorkspaceInputSchema,
} from "./learning.schema";

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

describe("learner resource input", () => {
  it("requires the exact course item for a course resource", () => {
    expect(
      learnerResourceInputSchema.parse({
        enrollmentId: "enrollment_1",
        courseVersionItemId: "course_item_1",
        resourceVersionId: "resource_version_1",
      }),
    ).toMatchObject({ courseVersionItemId: "course_item_1" });
    expect(() =>
      learnerResourceInputSchema.parse({
        enrollmentId: "enrollment_1",
        resourceVersionId: "resource_version_1",
      }),
    ).toThrow();
  });
});
