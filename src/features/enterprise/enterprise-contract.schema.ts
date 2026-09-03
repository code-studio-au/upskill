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
      eventOccurrenceId: string;
      registrationRequired: boolean;
    }
  | {
      status: "already-registered";
      eventOccurrenceId: string;
      registrationRequired: boolean;
      canOpenEvent: boolean;
    }
  | { status: "unavailable" }
  | { status: "unauthenticated" };

export type EnterpriseEventRegistrationResult =
  | {
      status: "registered";
      eventRegistrationId: string;
      eventOccurrenceId: string;
      registrationRequired: boolean;
    }
  | {
      status: "already-registered";
      eventOccurrenceId: string;
      registrationRequired: boolean;
      canOpenEvent: boolean;
    }
  | { status: "unavailable" }
  | { status: "unauthenticated" };
