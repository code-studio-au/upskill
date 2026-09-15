type EnvironmentName = "staging" | "production";

export interface EnvironmentConfig {
  name: EnvironmentName;
  cidr: string;
  deletionProtection: boolean;
  instanceType: string;
  databaseInstanceType: string;
  databaseBackupRetentionDays: number;
  alarmEmail: string;
  liveKitApprovedMonthlySpendAud: number;
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
  },
};

export function environmentConfig(
  value: unknown,
  liveKitApprovedMonthlySpendAud?: unknown,
): EnvironmentConfig {
  if (value !== "staging" && value !== "production")
    throw new Error("CDK context environment must be staging or production");
  if (liveKitApprovedMonthlySpendAud === undefined)
    return configurations[value];
  const parsedSpend = Number(liveKitApprovedMonthlySpendAud);
  if (!Number.isFinite(parsedSpend) || parsedSpend <= 0)
    throw new Error(
      "CDK context liveKitApprovedMonthlySpendAud must be a positive number",
    );
  return {
    ...configurations[value],
    liveKitApprovedMonthlySpendAud: parsedSpend,
  };
}
