export interface PackageHostProperties {
  HostedZoneId?: string;
  InstanceId?: string;
  ParameterName?: string;
  PhysicalResourceId?: string;
  PublicIp?: string;
  Region?: string;
  Suffix?: string;
}

export interface PackageHostLifecyclePlan {
  cleanupInstanceId: string;
  current: { hostedZoneId: string; publicIp: string; suffix: string } | null;
  parameterName: string;
  previous: { hostedZoneId: string; publicIp: string; suffix: string } | null;
  region: string;
}

export function lifecyclePlan(
  requestType: "Create" | "Update" | "Delete",
  resourceProperties: PackageHostProperties,
  oldProperties?: PackageHostProperties,
): PackageHostLifecyclePlan;

export function normalizeListedRecordName(name: string): string;
