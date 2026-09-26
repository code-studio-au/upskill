import { z } from "#/validation/zod";
import {
  deleteOfflineScormCourseIndexDatabase,
  OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
  offlineScormCourseIndexRequestResult,
  offlineScormCourseIndexTransactionComplete,
  openOfflineScormCourseIndexDatabase,
} from "./offline-scorm-course-index-database";

const offlineScormCourseIndexCommonShape = {
  schemaVersion: z.literal(1),
  key: z.string().check(z.minLength(3), z.maxLength(520)),
  enrollmentId: z.string().check(z.minLength(1), z.maxLength(255)),
  courseVersionItemId: z.string().check(z.minLength(1), z.maxLength(255)),
  modulePosition: z.number().check(z.int(), z.nonnegative()),
  title: z.string().check(z.minLength(1), z.maxLength(200)),
  learnerId: z.string().check(z.minLength(1), z.maxLength(255)),
  learnerName: z.string().check(z.minLength(1), z.maxLength(200)),
  learningRuntimeUrl: z.url(),
  updatedAt: z.iso.datetime(),
} as const;

const offlineScormCourseIndexProvisionedShape = {
  ...offlineScormCourseIndexCommonShape,
  attemptId: z.string().check(z.minLength(1), z.maxLength(255)),
  entitlementId: z.string().check(z.minLength(1), z.maxLength(255)),
  packageOrigin: z.url(),
  intendedLaunchExpiresAt: z.iso.datetime(),
} as const;

const offlineScormCourseIndexRecordSchema = z.union([
  z.discriminatedUnion("state", [
    z.strictObject({
      ...offlineScormCourseIndexCommonShape,
      state: z.literal("activating"),
    }),
    z.strictObject({
      ...offlineScormCourseIndexProvisionedShape,
      state: z.literal("downloading"),
    }),
    z.strictObject({
      ...offlineScormCourseIndexProvisionedShape,
      state: z.literal("ready"),
    }),
    z.strictObject({
      ...offlineScormCourseIndexProvisionedShape,
      state: z.literal("blocked"),
    }),
    z.strictObject({
      ...offlineScormCourseIndexProvisionedShape,
      state: z.literal("removing"),
    }),
  ]),
  z.pipe(
    z.strictObject(offlineScormCourseIndexProvisionedShape),
    z.transform((record) => ({ ...record, state: "ready" as const })),
  ),
]);

export type OfflineScormCourseIndexRecord = z.infer<
  typeof offlineScormCourseIndexRecordSchema
>;
export type OfflineScormCourseIndexManagedRecord = Extract<
  OfflineScormCourseIndexRecord,
  { state: "blocked" | "ready" | "removing" }
>;

export function offlineScormCourseIndexLearnerId(
  records: readonly OfflineScormCourseIndexRecord[],
): string | undefined {
  const learnerIds = new Set(records.map((record) => record.learnerId));
  if (learnerIds.size > 1)
    throw new Error("Offline courses belong to more than one learner");
  return learnerIds.values().next().value;
}

export function offlineScormCourseIndexKey(
  enrollmentId: string,
  courseVersionItemId: string,
): string {
  return `${enrollmentId}:${courseVersionItemId}`;
}

export async function getOfflineScormCourseIndexRecord(
  key: string,
): Promise<OfflineScormCourseIndexRecord | undefined> {
  const database = await openOfflineScormCourseIndexDatabase();
  let value: unknown;
  let empty: boolean;
  try {
    const transaction = database.transaction(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
      "readonly",
    );
    const completed = offlineScormCourseIndexTransactionComplete(transaction);
    const store = transaction.objectStore(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
    );
    const [storedValue, count] = await Promise.all([
      offlineScormCourseIndexRequestResult<unknown>(store.get(key)),
      offlineScormCourseIndexRequestResult(store.count()),
    ]);
    value = storedValue;
    empty = count === 0;
    await completed;
  } finally {
    database.close();
  }
  if (empty) await deleteOfflineScormCourseIndexDatabase();
  return value === undefined
    ? undefined
    : offlineScormCourseIndexRecordSchema.parse(value);
}

export async function putOfflineScormCourseIndexRecord(
  input: OfflineScormCourseIndexRecord,
): Promise<void> {
  const record = offlineScormCourseIndexRecordSchema.parse(input);
  const database = await openOfflineScormCourseIndexDatabase();
  try {
    const transaction = database.transaction(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
      "readwrite",
    );
    transaction.objectStore(OFFLINE_SCORM_COURSE_INDEX_STORE_NAME).put(record);
    await offlineScormCourseIndexTransactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function deleteOfflineScormCourseIndexRecord(
  key: string,
): Promise<void> {
  const database = await openOfflineScormCourseIndexDatabase();
  let remaining: number;
  try {
    const transaction = database.transaction(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
      "readwrite",
    );
    const completed = offlineScormCourseIndexTransactionComplete(transaction);
    const store = transaction.objectStore(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
    );
    store.delete(key);
    remaining = await offlineScormCourseIndexRequestResult(store.count());
    await completed;
  } finally {
    database.close();
  }
  if (remaining === 0) await deleteOfflineScormCourseIndexDatabase();
}

export async function listOfflineScormCourseIndexRecords(): Promise<
  OfflineScormCourseIndexRecord[]
> {
  const database = await openOfflineScormCourseIndexDatabase();
  let records: OfflineScormCourseIndexRecord[];
  try {
    const transaction = database.transaction(
      OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
      "readonly",
    );
    const values = await offlineScormCourseIndexRequestResult<unknown[]>(
      transaction.objectStore(OFFLINE_SCORM_COURSE_INDEX_STORE_NAME).getAll(),
    );
    await offlineScormCourseIndexTransactionComplete(transaction);
    records = values.map((value) =>
      offlineScormCourseIndexRecordSchema.parse(value),
    );
  } finally {
    database.close();
  }
  if (records.length === 0) await deleteOfflineScormCourseIndexDatabase();
  return records;
}
