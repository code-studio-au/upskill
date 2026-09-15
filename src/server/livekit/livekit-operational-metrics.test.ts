import { describe, expect, it } from "vitest";
import {
  isLiveKitSpendObservationFresh,
  liveKitOperationalMetricValues,
  parseLiveKitSpendObservation,
} from "./livekit-operational-metrics";

const now = new Date("2026-09-15T10:00:00.000Z");

describe("LiveKit operational metrics", () => {
  it("treats disabled delivery as healthy without emitting spend", () => {
    expect(
      liveKitOperationalMetricValues({
        enabled: false,
        providerAvailable: false,
        activeRooms: 5,
        connectedParticipants: 50,
        activeEgressJobs: 2,
        capacityDenials: 3,
        managedEgressFailures: 1,
        approvedMaxConcurrentRooms: 5,
        approvedMaxConcurrentParticipants: 50,
        approvedMaxConcurrentEgressJobs: 2,
        spendObservation: null,
        now,
      }),
    ).toMatchObject({
      LiveKitProviderAvailable: 1,
      LiveKitQuotaExhausted: 0,
      LiveKitMonthlySpendAud: -1,
      LiveKitSpendObservationFresh: 1,
    });
  });

  it("reports saturation, quota denial and managed Egress failure signals", () => {
    expect(
      liveKitOperationalMetricValues({
        enabled: true,
        providerAvailable: true,
        activeRooms: 4,
        connectedParticipants: 90,
        activeEgressJobs: 2,
        capacityDenials: 1,
        managedEgressFailures: 1,
        approvedMaxConcurrentRooms: 5,
        approvedMaxConcurrentParticipants: 100,
        approvedMaxConcurrentEgressJobs: 2,
        spendObservation: {
          billingMonth: "2026-09",
          monthlySpendAud: 75.5,
          observedAt: "2026-09-15T09:00:00.000Z",
        },
        now,
      }),
    ).toEqual({
      LiveKitProviderAvailable: 1,
      LiveKitActiveRooms: 4,
      LiveKitConnectedParticipants: 90,
      LiveKitActiveEgressJobs: 2,
      LiveKitCapacityDenials: 1,
      LiveKitQuotaExhausted: 1,
      LiveKitParticipantUtilizationPercent: 90,
      LiveKitConcurrentRoomUtilizationPercent: 80,
      LiveKitEgressUtilizationPercent: 100,
      LiveKitManagedEgressFailures: 1,
      LiveKitMonthlySpendAud: 75.5,
      LiveKitSpendObservationFresh: 1,
    });
  });

  it("fails closed for missing, stale, future and cross-month spend evidence", () => {
    const valid = parseLiveKitSpendObservation({
      billingMonth: "2026-09",
      monthlySpendAud: 12.25,
      observedAt: "2026-09-15T09:00:00Z",
    });
    expect(valid).not.toBeNull();
    if (!valid) throw new Error("Expected a valid spend observation");
    expect(isLiveKitSpendObservationFresh(valid, now)).toBe(true);
    expect(
      isLiveKitSpendObservationFresh(
        { ...valid, observedAt: "2026-09-14T08:59:59Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isLiveKitSpendObservationFresh(
        { ...valid, observedAt: "2026-09-15T10:05:01Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isLiveKitSpendObservationFresh(
        { ...valid, billingMonth: "2026-08" },
        now,
      ),
    ).toBe(false);
    expect(parseLiveKitSpendObservation({ monthlySpendAud: -1 })).toBeNull();
  });
});
