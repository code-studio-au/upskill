export type EnterpriseCourseAccessResult =
  | {
      status: "ready";
      enterpriseContractId: string;
      contractName: string;
      organizationName: string;
    }
  | { status: "already-enrolled" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type EnterpriseCourseEnrollmentResult =
  | {
      status: "enrolled";
      courseTitle: string;
      enrollmentId: string;
    }
  | { status: "already-enrolled" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type EnterpriseEventAccessResult =
  | {
      status: "ready";
      contractName: string;
      organizationName: string;
    }
  | { status: "already-registered" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type EnterpriseEventRegistrationResult =
  | { status: "registered"; eventRegistrationId: string }
  | { status: "already-registered" }
  | { status: "unavailable" }
  | { status: "unauthenticated" };
