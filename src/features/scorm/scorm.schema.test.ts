import { describe, expect, it } from "vitest";
import {
  scormLaunchInputSchema,
  scormOpaqueTokenSchema,
  scormProgressInputSchema,
} from "./scorm.schema";

describe("SCORM boundary schemas", () => {
  it("accepts a bounded module launch", () => {
    expect(
      scormLaunchInputSchema.parse({
        enrollmentId: "enrollment_123",
        modulePosition: 2,
      }),
    ).toEqual({ enrollmentId: "enrollment_123", modulePosition: 2 });
  });

  it.each(["../enrollment", "enrollment?admin=true"])(
    "rejects unsafe enrollment identifier %s",
    (enrollmentId) => {
      expect(() =>
        scormLaunchInputSchema.parse({ enrollmentId, modulePosition: 0 }),
      ).toThrow();
    },
  );

  it("accepts only 256-bit base64url tokens", () => {
    expect(scormOpaqueTokenSchema.parse("a".repeat(43))).toBe("a".repeat(43));
    expect(() => scormOpaqueTokenSchema.parse("a".repeat(42))).toThrow();
  });

  it("validates progress and score relationships", () => {
    const progress = {
      lessonStatus: "incomplete" as const,
      location: "slide-4",
      suspendData: "state",
      scoreRaw: 75,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: 180,
    };
    expect(scormProgressInputSchema.parse(progress)).toEqual(progress);
    expect(() =>
      scormProgressInputSchema.parse({ ...progress, scoreRaw: 101 }),
    ).toThrow();
    expect(() =>
      scormProgressInputSchema.parse({
        ...progress,
        scoreMin: 100,
        scoreMax: 0,
      }),
    ).toThrow();
  });
});
