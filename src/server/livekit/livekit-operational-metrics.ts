const SPEND_OBSERVATION_MAX_AGE_MILLISECONDS = 25 * 60 * 60 * 1_000;
const SPEND_OBSERVATION_MAX_FUTURE_SKEW_MILLISECONDS = 5 * 60 * 1_000;

export interface LiveKitSpendObservation {
  billingMonth: string;
  monthlySpendAud: number;
  observedAt: string;
}

export interface LiveKitOperationalMetricInput {
  enabled: boolean;
  providerAvailable: boolean;
  activeRooms: number;
  connectedParticipants: number;
  activeEgressJobs: number;
  capacityDenials: number;
  managedEgressFailures: number;
  approvedMaxConcurrentRooms: number;
  approvedMaxConcurrentParticipants: number;
  approvedMaxConcurrentEgressJobs: number;
  spendObservation: LiveKitSpendObservation | null;
  now: Date;
}

export interface LiveKitOperationalMetricValues {
  LiveKitProviderAvailable: number;
  LiveKitActiveRooms: number;
  LiveKitConnectedParticipants: number;
  LiveKitActiveEgressJobs: number;
  LiveKitCapacityDenials: number;
  LiveKitQuotaExhausted: number;
  LiveKitParticipantUtilizationPercent: number;
  LiveKitConcurrentRoomUtilizationPercent: number;
  LiveKitEgressUtilizationPercent: number;
  LiveKitManagedEgressFailures: number;
  LiveKitMonthlySpendAud: number;
  LiveKitSpendObservationFresh: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function utilization(value: number, approvedMaximum: number): number {
  if (!Number.isFinite(approvedMaximum) || approvedMaximum <= 0) return 0;
  return (nonNegative(value) / approvedMaximum) * 100;
}

function currentBillingMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function parseLiveKitSpendObservation(
  value: unknown,
): LiveKitSpendObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.billingMonth !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(candidate.billingMonth) ||
    typeof candidate.monthlySpendAud !== "number" ||
    !Number.isFinite(candidate.monthlySpendAud) ||
    candidate.monthlySpendAud < 0 ||
    typeof candidate.observedAt !== "string"
  )
    return null;
  const observedAt = new Date(candidate.observedAt);
  if (Number.isNaN(observedAt.getTime())) return null;
  return {
    billingMonth: candidate.billingMonth,
    monthlySpendAud: candidate.monthlySpendAud,
    observedAt: observedAt.toISOString(),
  };
}

export function isLiveKitSpendObservationFresh(
  observation: LiveKitSpendObservation | null,
  now: Date,
): boolean {
  if (!observation || observation.billingMonth !== currentBillingMonth(now))
    return false;
  const observedAt = new Date(observation.observedAt).getTime();
  const age = now.getTime() - observedAt;
  return (
    age >= -SPEND_OBSERVATION_MAX_FUTURE_SKEW_MILLISECONDS &&
    age <= SPEND_OBSERVATION_MAX_AGE_MILLISECONDS
  );
}

export function liveKitOperationalMetricValues(
  input: LiveKitOperationalMetricInput,
): LiveKitOperationalMetricValues {
  if (!input.enabled)
    return {
      LiveKitProviderAvailable: 1,
      LiveKitActiveRooms: 0,
      LiveKitConnectedParticipants: 0,
      LiveKitActiveEgressJobs: 0,
      LiveKitCapacityDenials: 0,
      LiveKitQuotaExhausted: 0,
      LiveKitParticipantUtilizationPercent: 0,
      LiveKitConcurrentRoomUtilizationPercent: 0,
      LiveKitEgressUtilizationPercent: 0,
      LiveKitManagedEgressFailures: 0,
      LiveKitMonthlySpendAud: -1,
      LiveKitSpendObservationFresh: 1,
    };

  const activeRooms = nonNegative(input.activeRooms);
  const connectedParticipants = nonNegative(input.connectedParticipants);
  const activeEgressJobs = nonNegative(input.activeEgressJobs);
  const capacityDenials = nonNegative(input.capacityDenials);
  const participantUtilization = utilization(
    connectedParticipants,
    input.approvedMaxConcurrentParticipants,
  );
  const roomUtilization = utilization(
    activeRooms,
    input.approvedMaxConcurrentRooms,
  );
  const egressUtilization = utilization(
    activeEgressJobs,
    input.approvedMaxConcurrentEgressJobs,
  );
  const spendFresh = isLiveKitSpendObservationFresh(
    input.spendObservation,
    input.now,
  );
  return {
    LiveKitProviderAvailable: input.providerAvailable ? 1 : 0,
    LiveKitActiveRooms: activeRooms,
    LiveKitConnectedParticipants: connectedParticipants,
    LiveKitActiveEgressJobs: activeEgressJobs,
    LiveKitCapacityDenials: capacityDenials,
    LiveKitQuotaExhausted:
      capacityDenials > 0 ||
      participantUtilization >= 100 ||
      roomUtilization >= 100 ||
      egressUtilization >= 100
        ? 1
        : 0,
    LiveKitParticipantUtilizationPercent: participantUtilization,
    LiveKitConcurrentRoomUtilizationPercent: roomUtilization,
    LiveKitEgressUtilizationPercent: egressUtilization,
    LiveKitManagedEgressFailures: nonNegative(input.managedEgressFailures),
    LiveKitMonthlySpendAud: spendFresh
      ? (input.spendObservation?.monthlySpendAud ?? 0)
      : 0,
    LiveKitSpendObservationFresh: spendFresh ? 1 : 0,
  };
}
