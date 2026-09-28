import "@tanstack/react-start/server-only";

import {
  InvokeCommand,
  LambdaClient,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { z } from "#/validation/zod.server";
import type { ServerEnv } from "#/server/runtime-environment";

const distributionResponseSchema = z
  .object({
    phase: z.enum([
      "allocated-disabled",
      "recovered-disabled",
      "waiting-for-deployment",
      "activating",
      "active",
      "disabling",
    ]),
    distributionId: z.string().regex(/^[A-Z0-9]{8,32}$/u),
    packageSiteOrigin: z.url(),
    status: z.enum(["Deployed", "InProgress"]),
  })
  .superRefine((value, context) => {
    const origin = new URL(value.packageSiteOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?[.]cloudfront[.]net$/u.test(
        origin.hostname,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["packageSiteOrigin"],
        message:
          "Allocator response must contain a canonical CloudFront origin",
      });
    if (value.phase === "active" && value.status !== "Deployed")
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "An active distribution must be deployed",
      });
  });

const retirementResponseSchema = z.union([
  distributionResponseSchema,
  z
    .object({
      phase: z.literal("deleted"),
      distributionId: z.string().regex(/^[A-Z0-9]{8,32}$/u),
    })
    .strict(),
]);

export type OfflineScormCloudFrontAllocatorResponse = z.infer<
  typeof distributionResponseSchema
>;

export type OfflineScormCloudFrontRetirementResponse = z.infer<
  typeof retirementResponseSchema
>;

export interface OfflineScormCloudFrontProvider {
  allocate(
    entitlementId: string,
  ): Promise<OfflineScormCloudFrontAllocatorResponse>;
  activate(
    entitlementId: string,
    distributionId: string,
  ): Promise<OfflineScormCloudFrontAllocatorResponse>;
  retire(
    entitlementId: string,
    distributionId: string,
  ): Promise<OfflineScormCloudFrontRetirementResponse>;
}

export type OfflineScormCloudFrontProviderErrorCode =
  | "allocator_function_error"
  | "allocator_invoke_failed"
  | "allocator_response_invalid";

export class OfflineScormCloudFrontProviderError extends Error {
  constructor(readonly code: OfflineScormCloudFrontProviderErrorCode) {
    super(`Offline SCORM CloudFront provider failed: ${code}`);
    this.name = "OfflineScormCloudFrontProviderError";
  }
}

interface LambdaInvoker {
  send(command: InvokeCommand): Promise<InvokeCommandOutput>;
}

export class LambdaOfflineScormCloudFrontProvider implements OfflineScormCloudFrontProvider {
  constructor(
    private readonly functionName: string,
    private readonly client: LambdaInvoker,
  ) {}

  allocate(
    entitlementId: string,
  ): Promise<OfflineScormCloudFrontAllocatorResponse> {
    return this.invoke({ operation: "allocate", entitlementId });
  }

  activate(
    entitlementId: string,
    distributionId: string,
  ): Promise<OfflineScormCloudFrontAllocatorResponse> {
    return this.invoke({
      operation: "activate",
      entitlementId,
      distributionId,
    });
  }

  retire(
    entitlementId: string,
    distributionId: string,
  ): Promise<OfflineScormCloudFrontRetirementResponse> {
    return this.invoke({
      operation: "retire",
      entitlementId,
      distributionId,
    });
  }

  private invoke(
    payload:
      | { operation: "allocate"; entitlementId: string }
      | {
          operation: "activate";
          entitlementId: string;
          distributionId: string;
        },
  ): Promise<OfflineScormCloudFrontAllocatorResponse>;
  private invoke(payload: {
    operation: "retire";
    entitlementId: string;
    distributionId: string;
  }): Promise<OfflineScormCloudFrontRetirementResponse>;
  private async invoke(
    payload:
      | { operation: "allocate"; entitlementId: string }
      | {
          operation: "activate";
          entitlementId: string;
          distributionId: string;
        }
      | {
          operation: "retire";
          entitlementId: string;
          distributionId: string;
        },
  ): Promise<
    | OfflineScormCloudFrontAllocatorResponse
    | OfflineScormCloudFrontRetirementResponse
  > {
    let output: InvokeCommandOutput;
    try {
      output = await this.client.send(
        new InvokeCommand({
          FunctionName: this.functionName,
          InvocationType: "RequestResponse",
          Payload: Buffer.from(JSON.stringify(payload), "utf8"),
        }),
      );
    } catch {
      throw new OfflineScormCloudFrontProviderError("allocator_invoke_failed");
    }
    if (output.FunctionError)
      throw new OfflineScormCloudFrontProviderError("allocator_function_error");
    if (!output.Payload || output.Payload.byteLength > 16_384)
      throw new OfflineScormCloudFrontProviderError(
        "allocator_response_invalid",
      );
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(output.Payload).toString("utf8"),
      );
      const response =
        payload.operation === "retire"
          ? retirementResponseSchema.parse(decoded)
          : distributionResponseSchema.parse(decoded);
      if (
        (payload.operation === "allocate" &&
          response.phase !== "allocated-disabled" &&
          response.phase !== "recovered-disabled") ||
        (payload.operation === "activate" &&
          response.phase !== "waiting-for-deployment" &&
          response.phase !== "activating" &&
          response.phase !== "active") ||
        (payload.operation === "retire" &&
          response.phase !== "waiting-for-deployment" &&
          response.phase !== "disabling" &&
          response.phase !== "deleted")
      )
        throw new Error("Allocator phase does not match the operation");
      return response;
    } catch {
      throw new OfflineScormCloudFrontProviderError(
        "allocator_response_invalid",
      );
    }
  }
}

export function createConfiguredOfflineScormCloudFrontProvider(
  environment: ServerEnv,
): OfflineScormCloudFrontProvider | null {
  const functionName =
    environment.OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME;
  if (!functionName) return null;
  if (environment.UPSKILL_PROCESS_ROLE !== "worker")
    throw new Error(
      "Offline SCORM CloudFront allocator access is restricted to the worker process",
    );
  return new LambdaOfflineScormCloudFrontProvider(
    functionName,
    new LambdaClient({ region: environment.AWS_REGION, maxAttempts: 3 }),
  );
}
