type EnvironmentName = "staging" | "production";

interface OfflineScormPackageHostConfig {
  suffix: string;
  hostedZoneId: string;
  hostedZoneName: string;
}

export interface EnvironmentConfig {
  name: EnvironmentName;
  cidr: string;
  deletionProtection: boolean;
  instanceType: string;
  databaseInstanceType: string;
  databaseBackupRetentionDays: number;
  alarmEmail: string;
  liveKitApprovedMonthlySpendAud: number;
  offlineScormPackageHost: OfflineScormPackageHostConfig | null;
}

const configurations: Record<EnvironmentName, EnvironmentConfig> = {
  staging: {
    name: "staging",
    cidr: "10.30.0.0/16",
    deletionProtection: false,
    instanceType: "t4g.micro",
    databaseInstanceType: "t4g.micro",
    databaseBackupRetentionDays: 7,
    alarmEmail: "ops@codestudio.au",
    liveKitApprovedMonthlySpendAud: 0,
    offlineScormPackageHost: null,
  },
  production: {
    name: "production",
    cidr: "10.40.0.0/16",
    deletionProtection: true,
    instanceType: "t4g.micro",
    databaseInstanceType: "t4g.micro",
    databaseBackupRetentionDays: 14,
    alarmEmail: "ops@codestudio.au",
    liveKitApprovedMonthlySpendAud: 0,
    offlineScormPackageHost: null,
  },
};

function canonicalDnsName(label: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      value,
    )
  )
    throw new Error(`${label} must be canonical lowercase DNS`);
  return value;
}

function offlineScormPackageHostConfig(input: {
  suffix: unknown;
  hostedZoneId: unknown;
  hostedZoneName: unknown;
}): OfflineScormPackageHostConfig | null {
  const configured = [input.suffix, input.hostedZoneId, input.hostedZoneName];
  if (configured.every((value) => value === undefined)) return null;
  if (configured.some((value) => value === undefined))
    throw new Error(
      "CDK contexts offlineScormPackageSiteSuffix, offlineScormHostedZoneId and offlineScormHostedZoneName must be configured together",
    );
  const suffix = canonicalDnsName(
    "CDK context offlineScormPackageSiteSuffix",
    input.suffix,
  );
  const hostedZoneName = canonicalDnsName(
    "CDK context offlineScormHostedZoneName",
    input.hostedZoneName,
  );
  if (suffix !== hostedZoneName && !suffix.endsWith(`.${hostedZoneName}`))
    throw new Error(
      "CDK context offlineScormPackageSiteSuffix must belong to offlineScormHostedZoneName",
    );
  if (typeof input.hostedZoneId !== "string")
    throw new Error("CDK context offlineScormHostedZoneId is invalid");
  const hostedZoneId = input.hostedZoneId.replace(/^\/hostedzone\//u, "");
  if (!/^Z[A-Z0-9]+$/u.test(hostedZoneId))
    throw new Error("CDK context offlineScormHostedZoneId is invalid");
  return { suffix, hostedZoneId, hostedZoneName };
}

export function environmentConfig(
  value: unknown,
  liveKitApprovedMonthlySpendAud?: unknown,
  offlineScormPackageHost: {
    suffix: unknown;
    hostedZoneId: unknown;
    hostedZoneName: unknown;
  } = {
    suffix: undefined,
    hostedZoneId: undefined,
    hostedZoneName: undefined,
  },
): EnvironmentConfig {
  if (value !== "staging" && value !== "production")
    throw new Error("CDK context environment must be staging or production");
  let parsedSpend = configurations[value].liveKitApprovedMonthlySpendAud;
  if (liveKitApprovedMonthlySpendAud !== undefined) {
    parsedSpend = Number(liveKitApprovedMonthlySpendAud);
    if (!Number.isFinite(parsedSpend) || parsedSpend <= 0)
      throw new Error(
        "CDK context liveKitApprovedMonthlySpendAud must be a positive number",
      );
  }
  return {
    ...configurations[value],
    liveKitApprovedMonthlySpendAud: parsedSpend,
    offlineScormPackageHost: offlineScormPackageHostConfig(
      offlineScormPackageHost,
    ),
  };
}
