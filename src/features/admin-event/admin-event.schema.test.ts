import { describe, expect, it } from "vitest";
import {
  adminEventOccurrenceCreateSchema,
  adminEventOccurrenceFormSchema,
  adminEventTemplateCreateSchema,
  normalizeEventDomains,
} from "./admin-event.schema";

const validOccurrence = {
  eventTemplateVersionId: "event_template_version_1",
  title: "Statewide workshop",
  deliveryMode: "hybrid" as const,
  registrationMode: "required_restricted" as const,
  approvalMode: "manual" as const,
  timezone: "Australia/Sydney",
  startsAt: "2027-08-20T23:00:00.000Z",
  endsAt: "2027-08-21T05:00:00.000Z",
  registrationOpensAt: "2027-06-01T00:00:00.000Z",
  registrationClosesAt: "2027-08-10T00:00:00.000Z",
  coordinatorLockAt: "2027-08-12T00:00:00.000Z",
  capacity: 80,
  venueName: "Learning Centre",
  venueAddress: "1 Example Street",
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
        virtualJoinUrl: "",
      }).success,
    ).toBe(true);
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
        slug: "workshop-template",
        summary: "Reusable workshop structure.",
        description: "A complete Event Template description.",
        sessionTitle: "Main workshop",
        sessionDurationMinutes: 90,
        hasCompletionCertificate: true,
      }).success,
    ).toBe(true);
  });
});
