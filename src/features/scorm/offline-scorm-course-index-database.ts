export const OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME =
  "upskill-offline-scorm-course-index-v1";
const DATABASE_VERSION = 1;
export const OFFLINE_SCORM_COURSE_INDEX_STORE_NAME = "courses";

export function offlineScormCourseIndexRequestResult<T>(
  request: IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      {
        once: true,
      },
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

export function offlineScormCourseIndexTransactionComplete(
  transaction: IDBTransaction,
): Promise<void> {
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

export async function openOfflineScormCourseIndexDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(
      OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME,
      DATABASE_VERSION,
    );
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (
          !request.result.objectStoreNames.contains(
            OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
          )
        )
          request.result.createObjectStore(
            OFFLINE_SCORM_COURSE_INDEX_STORE_NAME,
            { keyPath: "key" },
          );
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        resolve(request.result);
      },
      {
        once: true,
      },
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

export async function hasOfflineScormCourseIndexRecords(): Promise<boolean> {
  return (await indexedDB.databases()).some(
    (database) => database.name === OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME,
  );
}

export async function deleteOfflineScormCourseIndexDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(
      OFFLINE_SCORM_COURSE_INDEX_DATABASE_NAME,
    );
    request.addEventListener(
      "success",
      () => {
        resolve();
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
    request.addEventListener(
      "blocked",
      () => {
        reject(new Error("Offline course index is busy"));
      },
      { once: true },
    );
  });
}
