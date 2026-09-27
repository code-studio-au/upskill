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
}): OfflineScormCloudFrontDistributionConfig;

export function assertOwnedConfiguration(
  config: Record<string, unknown>,
  environment: "staging" | "production",
  entitlementId: string,
  originCapability: string,
  originDomain: string,
  logBucketDomain: string,
): void;

export function handler(event: unknown): Promise<unknown>;
