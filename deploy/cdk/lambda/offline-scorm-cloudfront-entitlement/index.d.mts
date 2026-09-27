export interface OfflineScormCloudFrontAllocatorRequest {
  operation: "allocate" | "describe" | "activate" | "retire";
  entitlementId: string;
  distributionId?: string;
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
}): Record<string, unknown>;

export function assertOwnedConfiguration(
  config: Record<string, unknown>,
  environment: "staging" | "production",
  entitlementId: string,
  originCapability: string,
): void;

export function handler(event: unknown): Promise<unknown>;
