import { describe, expect, it, vi } from "vitest";
import {
  hasRetainedOfflineScormServerState,
  listOfflineScormCourseRecoveryInventory,
} from "#/server/scorm/offline-scorm-inventory.server";

function inventoryRow(
  overrides: Partial<{
    attemptId: string;
    cleanupState: "cleared" | "clearing" | "needs_attention" | "pending";
    courseVersionItemId: string;
    enrollmentId: string;
    entitlementId: string;
    entitlementStatus: "active" | "resolved";
    intendedLaunchExpiresAt: Date;
    modulePosition: number | null;
    packageOrigin: string;
    title: string;
  }> = {},
) {
  return {
    attemptId: "attempt_1",
    cleanupState: "pending" as const,
    courseVersionItemId: "item_1",
    enrollmentId: "enrollment_1",
    entitlementId: "entitlement_1",
    entitlementStatus: "active" as const,
    intendedLaunchExpiresAt: new Date("2026-10-26T00:00:00.000Z"),
    modulePosition: 0,
    packageOrigin: `https://p-${"a".repeat(56)}.packages.example.test`,
    title: "Safety module",
    ...overrides,
  };
}

describe("offline SCORM server recovery inventory", () => {
  it("projects exact course cleanup handles for application-index recovery", async () => {
    const findCourseRows = vi.fn(() =>
      Promise.resolve([
        inventoryRow(),
        inventoryRow({
          attemptId: "attempt_2",
          cleanupState: "cleared",
          courseVersionItemId: "item_2",
          entitlementId: "entitlement_2",
          entitlementStatus: "resolved",
          modulePosition: 1,
        }),
      ]),
    );
    const records = await listOfflineScormCourseRecoveryInventory(
      {
        requestedEntitlementIds: ["entitlement_2"],
        userId: "learner_1",
      },
      { findCourseRows, findRetainedState: vi.fn() },
    );

    expect(findCourseRows).toHaveBeenCalledWith({
      requestedEntitlementIds: ["entitlement_2"],
      userId: "learner_1",
    });
    expect(records).toEqual([
      {
        ...inventoryRow(),
        intendedLaunchExpiresAt: "2026-10-26T00:00:00.000Z",
      },
      {
        ...inventoryRow({
          attemptId: "attempt_2",
          cleanupState: "cleared",
          courseVersionItemId: "item_2",
          entitlementId: "entitlement_2",
          entitlementStatus: "resolved",
          modulePosition: 1,
        }),
        intendedLaunchExpiresAt: "2026-10-26T00:00:00.000Z",
      },
    ]);
  });

  it("fails closed for inconsistent or unbounded recovery inventory", async () => {
    await expect(
      listOfflineScormCourseRecoveryInventory(
        { requestedEntitlementIds: [], userId: "learner_1" },
        {
          findCourseRows: () =>
            Promise.resolve([inventoryRow({ modulePosition: null })]),
          findRetainedState: vi.fn(),
        },
      ),
    ).rejects.toThrow("inconsistent");
    await expect(
      listOfflineScormCourseRecoveryInventory(
        { requestedEntitlementIds: [], userId: "learner_1" },
        {
          findCourseRows: () =>
            Promise.resolve(
              Array.from({ length: 257 }, (_, index) =>
                inventoryRow({ entitlementId: `entitlement_${String(index)}` }),
              ),
            ),
          findRetainedState: vi.fn(),
        },
      ),
    ).rejects.toThrow("exceeds its bound");
  });

  it("uses server authority to block sign-out", async () => {
    const findRetainedState = vi.fn(() => Promise.resolve(true));
    await expect(
      hasRetainedOfflineScormServerState("learner_1", {
        findCourseRows: vi.fn(),
        findRetainedState,
      }),
    ).resolves.toBe(true);
    expect(findRetainedState).toHaveBeenCalledWith("learner_1");
  });
});
