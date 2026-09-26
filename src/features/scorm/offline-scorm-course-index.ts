import { z } from "#/validation/zod";

const DATABASE_NAME = "upskill-offline-scorm-course-index-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "courses";

const offlineScormCourseIndexRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  key: z.string().check(z.minLength(3), z.maxLength(520)),
  enrollmentId: z.string().check(z.minLength(1), z.maxLength(255)),
  courseVersionItemId: z.string().check(z.minLength(1), z.maxLength(255)),
  modulePosition: z.number().check(z.int(), z.nonnegative()),
  title: z.string().check(z.minLength(1), z.maxLength(200)),
  attemptId: z.string().check(z.minLength(1), z.maxLength(255)),
  entitlementId: z.string().check(z.minLength(1), z.maxLength(255)),
  learnerId: z.string().check(z.minLength(1), z.maxLength(255)),
  learnerName: z.string().check(z.minLength(1), z.maxLength(200)),
  learningRuntimeUrl: z.url(),
  packageOrigin: z.url(),
  intendedLaunchExpiresAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type OfflineScormCourseIndexRecord = z.infer<
  typeof offlineScormCourseIndexRecordSchema
>;

export function offlineScormCourseIndexKey(
  enrollmentId: string,
  courseVersionItemId: string,
): string {
  return `${enrollmentId}:${courseVersionItemId}`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("Offline course index failed"));
      },
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      "complete",
      () => {
        resolve();
      },
      { once: true },
    );
    transaction.addEventListener(
      "abort",
      () => {
        reject(transaction.error ?? new Error("Offline course index aborted"));
      },
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => {
        reject(transaction.error ?? new Error("Offline course index failed"));
      },
      { once: true },
    );
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () => {
        reject(request.error ?? new Error("Offline course index failed"));
      },
      { once: true },
    );
  });
}

export async function getOfflineScormCourseIndexRecord(
  key: string,
): Promise<OfflineScormCourseIndexRecord | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const value = await requestResult<unknown>(
      transaction.objectStore(STORE_NAME).get(key),
    );
    await transactionComplete(transaction);
    return value === undefined
      ? undefined
      : offlineScormCourseIndexRecordSchema.parse(value);
  } finally {
    database.close();
  }
}

export async function putOfflineScormCourseIndexRecord(
  input: OfflineScormCourseIndexRecord,
): Promise<void> {
  const record = offlineScormCourseIndexRecordSchema.parse(input);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function deleteOfflineScormCourseIndexRecord(
  key: string,
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function listOfflineScormCourseIndexRecords(): Promise<
  OfflineScormCourseIndexRecord[]
> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const values = await requestResult<unknown[]>(
      transaction.objectStore(STORE_NAME).getAll(),
    );
    await transactionComplete(transaction);
    return values.map((value) =>
      offlineScormCourseIndexRecordSchema.parse(value),
    );
  } finally {
    database.close();
  }
}
