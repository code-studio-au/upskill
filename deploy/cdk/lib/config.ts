type EnvironmentName = "staging" | "production";

export interface EnvironmentConfig {
  name: EnvironmentName;
  cidr: string;
  dbMultiAz: boolean;
  deletionProtection: boolean;
  minCapacity: number;
  maxCapacity: number;
}

const configurations: Record<EnvironmentName, EnvironmentConfig> = {
  staging: {
    name: "staging",
    cidr: "10.30.0.0/16",
    dbMultiAz: false,
    deletionProtection: false,
    minCapacity: 1,
    maxCapacity: 2,
  },
  production: {
    name: "production",
    cidr: "10.40.0.0/16",
    dbMultiAz: true,
    deletionProtection: true,
    minCapacity: 2,
    maxCapacity: 6,
  },
};

export function environmentConfig(value: unknown): EnvironmentConfig {
  if (value !== "staging" && value !== "production")
    throw new Error("CDK context environment must be staging or production");
  return configurations[value];
}
