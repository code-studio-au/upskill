export interface OfflineScormCloudFrontAllocatorRequest {
  operation: "allocate" | "describe" | "activate" | "retire";
  entitlementId: string;
  distributionId?: string;
}

export interface OfflineScormCloudFrontDistributionConfig extends Record<
  string,
  unknown
> {
  Enabled: boolean;
  Origins: {
    Items: Array<Record<string, unknown> & { DomainName: string }>;
  };
  DefaultCacheBehavior: Record<string, unknown>;
  Logging: Record<string, unknown>;
  WebACLId: string;
}

export function distributionMarker(
  environment: "staging" | "production",
  entitlementId: string,
): string;

export function createOriginCapability(
  originKey: string,
  environment: "staging" | "production",
  entitlementId: string,
): string;

export function readOriginKey(
  secretArn: string,
  secretsManager: {
    SecretsManagerClient: new (configuration: Record<string, never>) => {
      send(command: unknown): Promise<{ SecretString?: string }>;
    };
    GetSecretValueCommand: new (input: { SecretId: string }) => unknown;
  },
): Promise<string>;

export function readCloudFrontWebAclArn(
  webAclName: string,
  environment: "staging" | "production",
  wafV2: {
    WAFV2Client: new (configuration: { region: "us-east-1" }) => {
      send(command: unknown): Promise<{
        NextMarker?: string;
        TagInfoForResource?: {
          TagList?: Array<{ Key?: string; Value?: string }>;
        };
        WebACLs?: Array<{ ARN?: string; Name?: string }>;
      }>;
    };
    ListWebACLsCommand: new (input: {
      Scope: "CLOUDFRONT";
      Limit: number;
      NextMarker?: string;
    }) => unknown;
    ListTagsForResourceCommand: new (input: { ResourceARN: string }) => unknown;
  },
): Promise<string>;

export function parseDistributionLimit(value: unknown): number;

export function classifyDistributionInventory<T extends { Comment?: string }>(
  distributions: T[],
  environment: "staging" | "production",
  entitlementId: string,
): { entitlementMatches: T[]; ownedCount: number };

export function selectDistributionForAllocation<T extends { Comment?: string }>(
  inventory: { entitlementMatches: T[]; ownedCount: number },
  limit: number,
): T | null;

export function parseAllocatorRequest(input: unknown):
  | { operation: "allocate"; entitlementId: string }
  | {
      operation: "describe" | "activate" | "retire";
      entitlementId: string;
      distributionId: string;
    };

export function createDistributionConfig(input: {
  environment: "staging" | "production";
  entitlementId: string;
  originDomain: string;
  originCapability: string;
  logBucketDomain: string;
  webAclArn: string;
}): OfflineScormCloudFrontDistributionConfig;

export function assertOwnedConfiguration(
  config: Record<string, unknown>,
  environment: "staging" | "production",
  entitlementId: string,
  originCapability: string,
  originDomain: string,
  logBucketDomain: string,
  webAclArn: string,
): void;

export function handler(event: unknown): Promise<unknown>;
