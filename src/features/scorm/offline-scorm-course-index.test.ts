import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteOfflineScormCourseIndexRecord,
  getOfflineScormCourseIndexRecord,
  listOfflineScormCourseIndexRecords,
  offlineScormCourseIndexLearnerId,
  offlineScormCourseIndexKey,
  putOfflineScormCourseIndexRecord,
} from "./offline-scorm-course-index";
import {
  hasOfflineScormCourseIndexRecords,
  OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
  offlineScormCourseIndexTransactionComplete,
  openOfflineScormCourseIndexDatabase,
} from "./offline-scorm-course-index-database";

describe("offline SCORM application course index", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("stores, replaces and removes only the bounded application projection", async () => {
    const key = offlineScormCourseIndexKey("enrollment_1", "item_1");
    const record = {
      schemaVersion: 1 as const,
      state: "ready" as const,
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
    await expect(hasOfflineScormCourseIndexRecords()).resolves.toBe(false);
    await putOfflineScormCourseIndexRecord(record);
    await expect(hasOfflineScormCourseIndexRecords()).resolves.toBe(true);
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
    await expect(hasOfflineScormCourseIndexRecords()).resolves.toBe(false);
    await expect(
      getOfflineScormCourseIndexRecord(key),
    ).resolves.toBeUndefined();
  });

  it("rejects malformed records before writing", async () => {
    await expect(
      putOfflineScormCourseIndexRecord({
        schemaVersion: 1,
        state: "ready",
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

  it("retains an activation marker before server authority is returned", async () => {
    const record = {
      schemaVersion: 1 as const,
      state: "activating" as const,
      key: offlineScormCourseIndexKey("enrollment_1", "item_1"),
      enrollmentId: "enrollment_1",
      courseVersionItemId: "item_1",
      modulePosition: 0,
      title: "Safety module",
      learnerId: "learner_1",
      learnerName: "Learner One",
      learningRuntimeUrl:
        "https://learning.example.test/api/scorm/offline-runtime/frame.html",
      updatedAt: "2026-09-26T00:00:00.000Z",
    };

    await putOfflineScormCourseIndexRecord(record);
    await expect(listOfflineScormCourseIndexRecords()).resolves.toEqual([
      record,
    ]);
  });

  it("reads records written before explicit lifecycle state was introduced", async () => {
    const legacy = {
      schemaVersion: 1 as const,
      key: "enrollment_1:item_1",
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
    const database = await openOfflineScormCourseIndexDatabase();
    const transaction = database.transaction(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
      "readwrite",
    );
    transaction.objectStore(OFFLINE_SCORM_COURSE_INDEX_STORE_NAME).put(legacy);
    await offlineScormCourseIndexTransactionComplete(transaction);
    database.close();

    await expect(listOfflineScormCourseIndexRecords()).resolves.toEqual([
      { ...legacy, state: "ready" },
    ]);
  });

  it("fails closed when application records span learner accounts", () => {
    const first = {
      schemaVersion: 1 as const,
      state: "activating" as const,
      key: "enrollment_1:item_1",
      enrollmentId: "enrollment_1",
      courseVersionItemId: "item_1",
      modulePosition: 0,
      title: "Safety module",
      learnerId: "learner_1",
      learnerName: "Learner One",
      learningRuntimeUrl:
        "https://learning.example.test/api/scorm/offline-runtime/frame.html",
      updatedAt: "2026-09-26T00:00:00.000Z",
    };
    expect(offlineScormCourseIndexLearnerId([first])).toBe("learner_1");
    expect(() =>
      offlineScormCourseIndexLearnerId([
        first,
        { ...first, key: "enrollment_2:item_2", learnerId: "learner_2" },
      ]),
    ).toThrow("more than one learner");
  });
});
