export const SCORM_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

export type AdminScormRemovalResult =
  | {
      status: "removed";
      data: { packageId: string; packageRemoved: boolean; version: number };
    }
  | {
      status: "in-use";
      data: { attemptCount: number; courseUsageCount: number };
    }
  | { status: "verification-pending" }
  | { status: "not-found" }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export interface AdminScormPackageVersionSummary {
  id: string;
  version: number;
  status: "quarantined" | "processing" | "ready" | "rejected";
  sourceBytes: number | null;
  failureCode: string | null;
  courseUsageCount: number;
  attemptCount: number;
}

export interface AdminScormPackageSummary {
  id: string;
  title: string;
  versions: Array<AdminScormPackageVersionSummary>;
}

export function isScormVerificationPending(
  status: AdminScormPackageVersionSummary["status"],
): boolean {
  return status === "quarantined" || status === "processing";
}

export type AdminScormLibraryResult =
  | { status: "ready"; data: Array<AdminScormPackageSummary> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
