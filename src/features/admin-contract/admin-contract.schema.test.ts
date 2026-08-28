import { describe, expect, it } from "vitest";
import {
  adminEnterpriseContractCreateSchema,
  adminEnterpriseContractBulkEnrollSchema,
  adminEnterpriseContractEligibilitySchema,
  adminEnterpriseContractLifecycleSchema,
  adminEnterpriseContractOwnerRevokeSchema,
  adminEnterpriseContractOwnerSchema,
  adminEnterpriseContractRevealSchema,
  adminEnterpriseContractRenewSchema,
  adminEnterpriseContractRotateCodeSchema,
} from "./admin-contract.schema";

const baseContract = {
  name: "Statewide learning agreement",
  reference: "STATE-2027",
  organizationName: "Example Health",
  startsOn: "2027-01-01",
  expiresOn: "2027-12-31",
  enrollmentDurationDays: 365,
  autoEnrollCourses: false,
  accessCode: "EXAMPLE HEALTH 2027",
  domains: "example.org, staff.example.com.au",
  courseIds: ["course_one"],
  eventOccurrenceIds: [],
  ownerEmails: "owner@example.org",
};

describe("enterprise contract administration schemas", () => {
  it("accepts course, event-only and uploaded-list draft configurations", () => {
    expect(
      adminEnterpriseContractCreateSchema.safeParse(baseContract).success,
    ).toBe(true);
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        domains: "",
        courseIds: [],
        eventOccurrenceIds: ["event_occurrence_one"],
        autoEnrollCourses: true,
      }).success,
    ).toBe(true);
  });

  it("rejects empty coverage, invalid periods, domains and code material", () => {
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        courseIds: [],
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        expiresOn: "2026-12-31",
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        domains: "not a domain",
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        accessCode: "short",
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractCreateSchema.safeParse({
        ...baseContract,
        ownerEmails: "valid@example.org, invalid-address",
      }).success,
    ).toBe(false);
  });

  it("validates bounded rotation, renewal and employee-list payloads", () => {
    expect(
      adminEnterpriseContractRotateCodeSchema.safeParse({
        enterpriseContractId: "enterprise_contract_one",
        accessCode: "ROTATED CONTRACT CODE",
      }).success,
    ).toBe(true);
    expect(
      adminEnterpriseContractRenewSchema.safeParse({
        enterpriseContractId: "enterprise_contract_one",
        name: "2028 renewal",
        reference: "STATE-2028",
        startsOn: "2028-01-01",
        expiresOn: "2028-12-31",
        accessCode: "STATE RENEWAL 2028",
      }).success,
    ).toBe(true);
    expect(
      adminEnterpriseContractEligibilitySchema.safeParse({
        enterpriseContractId: "enterprise_contract_one",
        csvText: "email,name\nlearner@example.org,Example Learner",
      }).success,
    ).toBe(true);
    expect(
      adminEnterpriseContractEligibilitySchema.safeParse({
        enterpriseContractId: "enterprise_contract_one",
        csvText: "",
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractLifecycleSchema.parse({
        enterpriseContractId: "enterprise_contract_one",
        action: "suspend",
      }).action,
    ).toBe("suspend");
    expect(
      adminEnterpriseContractRevealSchema.parse({
        enterpriseContractId: "enterprise_contract_one",
      }).enterpriseContractId,
    ).toBe("enterprise_contract_one");
    expect(
      adminEnterpriseContractOwnerSchema.parse({
        enterpriseContractId: "enterprise_contract_one",
        ownerEmails: "owner@example.org",
      }).ownerEmails,
    ).toBe("owner@example.org");
    expect(
      adminEnterpriseContractOwnerSchema.safeParse({
        enterpriseContractId: "enterprise_contract_one",
        ownerEmails: "not-an-email",
      }).success,
    ).toBe(false);
    expect(
      adminEnterpriseContractOwnerRevokeSchema.parse({
        enterpriseContractId: "enterprise_contract_one",
        ownerAssignmentId: "owner_one",
      }).ownerAssignmentId,
    ).toBe("owner_one");
    expect(
      adminEnterpriseContractBulkEnrollSchema.parse({
        enterpriseContractId: "enterprise_contract_one",
      }).enterpriseContractId,
    ).toBe("enterprise_contract_one");
  });
});
