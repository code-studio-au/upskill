import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteOfflineScormCourseIndexRecord,
  getOfflineScormCourseIndexRecord,
  listOfflineScormCourseIndexRecords,
  offlineScormCourseIndexKey,
  putOfflineScormCourseIndexRecord,
} from "./offline-scorm-course-index";

describe("offline SCORM application course index", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("stores, replaces and removes only the bounded application projection", async () => {
    const key = offlineScormCourseIndexKey("enrollment_1", "item_1");
    const record = {
      schemaVersion: 1 as const,
      key,
      enrollmentId: "enrollment_1",
      courseVersionItemId: "item_1",
      modulePosition: 0,
      title: "Safety module",
      attemptId: "attempt_1",
      entitlementId: "entitlement_1",
      learnerId: "learner_1",
      learnerName: "Learner One",
      learningRuntimeUrl:
        "https://learning.example.test/api/scorm/offline-runtime/frame.html",
      packageOrigin: `https://p-${"a".repeat(56)}.packages.example.test`,
      intendedLaunchExpiresAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    };

    await expect(
      getOfflineScormCourseIndexRecord(key),
    ).resolves.toBeUndefined();
    await putOfflineScormCourseIndexRecord(record);
    await expect(getOfflineScormCourseIndexRecord(key)).resolves.toEqual(
      record,
    );
    await expect(listOfflineScormCourseIndexRecords()).resolves.toEqual([
      record,
    ]);

    const replaced = {
      ...record,
      title: "Updated safety module",
      updatedAt: "2026-09-26T01:00:00.000Z",
    };
    await putOfflineScormCourseIndexRecord(replaced);
    await expect(getOfflineScormCourseIndexRecord(key)).resolves.toEqual(
      replaced,
    );

    await deleteOfflineScormCourseIndexRecord(key);
    await expect(
      getOfflineScormCourseIndexRecord(key),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed records before writing", async () => {
    await expect(
      putOfflineScormCourseIndexRecord({
        schemaVersion: 1,
        key: "bad",
        enrollmentId: "enrollment_1",
        courseVersionItemId: "item_1",
        modulePosition: -1,
        title: "Safety module",
        attemptId: "attempt_1",
        entitlementId: "entitlement_1",
        learnerId: "learner_1",
        learnerName: "Learner One",
        learningRuntimeUrl: "not-a-url",
        packageOrigin: "not-a-url",
        intendedLaunchExpiresAt: "not-an-instant",
        updatedAt: "not-an-instant",
      }),
    ).rejects.toBeDefined();
  });
});
