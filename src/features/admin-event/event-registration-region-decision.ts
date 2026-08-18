interface RegistrationRegionDecision {
  resolution:
    | "registered_region_confirmed"
    | "profile_region_confirmed"
    | "profile_aligned_to_registration"
    | "region_guest_confirmed";
  classification: "event_region" | "outside_event_region" | "no_region_guest";
  reportingRegionNameSnapshot: string | null;
  reportingRegionGroupNameSnapshot: string | null;
}

export function registrationRegionDecisionLabel(
  decision: RegistrationRegionDecision,
) {
  if (decision.classification === "no_region_guest")
    return "Region guest confirmed";
  if (decision.classification === "outside_event_region") {
    const region = [
      decision.reportingRegionGroupNameSnapshot,
      decision.reportingRegionNameSnapshot,
    ]
      .filter(Boolean)
      .join(" / ");
    return region
      ? `Outside-region guest confirmed · ${region}`
      : "Outside-region guest confirmed";
  }
  if (decision.resolution === "registered_region_confirmed")
    return "Registered region confirmed";
  if (decision.resolution === "profile_aligned_to_registration")
    return "Profile updated to registered region";
  return "Current profile region confirmed";
}
