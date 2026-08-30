import { describe, expect, it } from "vitest";
import {
  adminCoordinationRegionSaveSchema,
  adminEventOccurrenceCreateSchema,
  adminEventOccurrenceFormSchema,
  adminEventOccurrenceRescheduleFormSchema,
  adminEventStaffCandidateSearchSchema,
  adminEventStaffEligibilityGrantSchema,
  adminEventTemplateCreateSchema,
  normalizeEventDomains,
} from "./admin-event.schema";

const validOccurrence = {
  eventTemplateVersionId: "event_template_version_1",
  title: "Statewide workshop",
  slug: "statewide-workshop",
  deliveryMode: "virtual" as const,
  registrationMode: "required_restricted" as const,
  approvalMode: "manual" as const,
  timezone: "Australia/Sydney",
  localStartsAt: "2027-08-21T09:00:00",
  localEndsAt: "2027-08-21T15:00:00",
  localRegistrationOpensAt: "2027-06-01T10:00:00",
  localRegistrationClosesAt: "2027-08-10T10:00:00",
  localCoordinatorLockAt: "2027-08-12T10:00:00",
  startsAt: "2027-08-20T23:00:00.000Z",
  endsAt: "2027-08-21T05:00:00.000Z",
  registrationOpensAt: "2027-06-01T00:00:00.000Z",
  registrationClosesAt: "2027-08-10T00:00:00.000Z",
  coordinatorLockAt: "2027-08-12T00:00:00.000Z",
  capacity: 80,
  priceCents: null,
  salePriceCents: null,
  currency: "AUD" as const,
  bulkPricing: { enabled: false, tiers: [] },
  listInStore: false,
  featured: false,
  venueName: "",
  venueAddress: "",
  virtualJoinUrl: "https://meet.example.com/workshop",
  domains: "HEALTH.EXAMPLE.ORG, example.com",
};

const validOccurrenceForm = {
  ...validOccurrence,
  startsAt: "2027-08-21T09:00",
  endsAt: "2027-08-21T15:00",
  registrationOpensAt: "2027-06-01T10:00",
  registrationClosesAt: "2027-08-10T10:00",
  coordinatorLockAt: "2027-08-12T10:00",
};

describe("event administration schemas", () => {
  it("normalizes and deduplicates exact registration domains", () => {
    expect(
      normalizeEventDomains(
        "HEALTH.EXAMPLE.ORG, example.com\nhealth.example.org",
      ),
    ).toEqual(["health.example.org", "example.com"]);
    expect(normalizeEventDomains("not-a-domain")).toBeNull();
  });

  it("keeps delivery and registration modes independent", () => {
    expect(
      adminEventOccurrenceCreateSchema.safeParse(validOccurrence).success,
    ).toBe(true);
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        deliveryMode: "in_person",
        venueName: "Learning Centre",
        venueAddress: "1 Example Street",
        virtualJoinUrl: "",
      }).success,
    ).toBe(true);
  });

  it("requires coherent paid-entry pricing and automatic approval", () => {
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        registrationMode: "paid_entry",
        approvalMode: "automatic",
        registrationOpensAt: "",
        registrationClosesAt: "",
        coordinatorLockAt: "",
        localRegistrationOpensAt: "",
        localRegistrationClosesAt: "",
        localCoordinatorLockAt: "",
        domains: "",
        priceCents: 12_000,
        salePriceCents: 9_900,
        bulkPricing: {
          enabled: true,
          tiers: [{ minimumQuantity: 5, unitPriceCents: 8_500 }],
        },
        listInStore: true,
      }).success,
    ).toBe(true);
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        registrationMode: "paid_entry",
        approvalMode: "manual",
        priceCents: 12_000,
      }).success,
    ).toBe(false);
  });

  it("rejects the retired hybrid delivery mode", () => {
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        deliveryMode: "hybrid",
      }).success,
    ).toBe(false);
  });

  it("requires restricted domains and mode-specific locations", () => {
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        domains: "",
      }).success,
    ).toBe(false);
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        deliveryMode: "virtual",
        venueName: "",
        virtualJoinUrl: "",
      }).success,
    ).toBe(false);
  });

  it("accepts occurrence form wall-clock times for server conversion", () => {
    expect(
      adminEventOccurrenceFormSchema.safeParse(validOccurrenceForm).success,
    ).toBe(true);
  });

  it("rejects malformed local times", () => {
    expect(
      adminEventOccurrenceFormSchema.safeParse({
        ...validOccurrenceForm,
        startsAt: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported event timezones", () => {
    expect(
      adminEventOccurrenceFormSchema.safeParse({
        ...validOccurrenceForm,
        timezone: "Definitely/Not-A-Timezone",
      }).success,
    ).toBe(false);
  });

  it("rejects reversed occurrence and registration schedules", () => {
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        endsAt: validOccurrence.startsAt,
      }).success,
    ).toBe(false);
    expect(
      adminEventOccurrenceCreateSchema.safeParse({
        ...validOccurrence,
        coordinatorLockAt: "2027-08-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("validates initial immutable template content", () => {
    expect(
      adminEventTemplateCreateSchema.safeParse({
        title: "Workshop template",
        defaultAdministratorIds: ["admin_1"],
      }).success,
    ).toBe(true);
  });

  it("requires exact regional scope for coordinator eligibility", () => {
    expect(
      adminEventStaffEligibilityGrantSchema.safeParse({
        email: "presenter@example.com",
        responsibility: "presenter",
        regionId: null,
      }).success,
    ).toBe(true);
    expect(
      adminEventStaffEligibilityGrantSchema.safeParse({
        email: "coordinator@example.com",
        responsibility: "coordinator",
        regionId: "region_north",
      }).success,
    ).toBe(true);
    expect(
      adminEventStaffEligibilityGrantSchema.safeParse({
        email: "coordinator@example.com",
        responsibility: "coordinator",
        regionId: null,
      }).success,
    ).toBe(false);
    expect(
      adminEventStaffEligibilityGrantSchema.safeParse({
        email: "presenter@example.com",
        responsibility: "presenter",
        regionId: "region_north",
      }).success,
    ).toBe(false);
  });

  it("requires enough input and regional scope for staff autocomplete", () => {
    expect(
      adminEventStaffCandidateSearchSchema.safeParse({
        q: "pre",
        responsibility: "presenter",
        regionId: null,
      }).success,
    ).toBe(true);
    expect(
      adminEventStaffCandidateSearchSchema.safeParse({
        q: "coordinator",
        responsibility: "coordinator",
        regionId: "region_north",
      }).success,
    ).toBe(true);
    expect(
      adminEventStaffCandidateSearchSchema.safeParse({
        q: "c",
        responsibility: "coordinator",
        regionId: "region_north",
      }).success,
    ).toBe(false);
  });

  it("keeps region groups above selectable operational regions", () => {
    expect(
      adminCoordinationRegionSaveSchema.safeParse({
        regionId: null,
        name: "New South Wales",
        code: "NSW",
        kind: "group",
        parentId: null,
      }).success,
    ).toBe(true);
    expect(
      adminCoordinationRegionSaveSchema.safeParse({
        regionId: null,
        name: "Sydney Local Health District",
        code: "SLHD",
        kind: "operational",
        parentId: "region_group_nsw",
      }).success,
    ).toBe(true);
    expect(
      adminCoordinationRegionSaveSchema.safeParse({
        regionId: null,
        name: "Nested group",
        code: "NESTED",
        kind: "group",
        parentId: "region_group_nsw",
      }).success,
    ).toBe(false);
  });

  it("allows optional coordinators with confirmed, unique regional coverage", () => {
    const validReschedule = {
      eventOccurrenceId: "event_occurrence_1",
      occurrence: validOccurrenceForm,
      registrationWindowPolicy: "reopen" as const,
      regionsConfirmed: true as const,
      regionalCoverage: {
        regions: [{ regionId: "region_1", coordinatorIds: [] }],
        retirements: [
          { regionId: "region_2", disposition: "future_only" as const },
        ],
      },
    };
    expect(
      adminEventOccurrenceRescheduleFormSchema.safeParse(validReschedule)
        .success,
    ).toBe(true);
    expect(
      adminEventOccurrenceRescheduleFormSchema.safeParse({
        ...validReschedule,
        regionsConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      adminEventOccurrenceRescheduleFormSchema.safeParse({
        ...validReschedule,
        regionalCoverage: {
          regions: [
            { regionId: "region_1", coordinatorIds: ["coordinator_1"] },
            { regionId: "region_1", coordinatorIds: ["coordinator_2"] },
          ],
          retirements: [],
        },
      }).success,
    ).toBe(false);
  });
});
