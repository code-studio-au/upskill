import {
  InvokeCommand,
  type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import {
  LambdaOfflineScormCloudFrontProvider,
  OfflineScormCloudFrontProviderError,
} from "./offline-scorm-cloudfront-provider.server";

function response(value: unknown): InvokeCommandOutput {
  return {
    Payload: Buffer.from(JSON.stringify(value), "utf8"),
  } as unknown as InvokeCommandOutput;
}

describe("offline SCORM CloudFront Lambda provider", () => {
  it("invokes the exact allocator synchronously with a bounded request", async () => {
    const send = vi
      .fn<(command: InvokeCommand) => Promise<InvokeCommandOutput>>()
      .mockResolvedValue(
        response({
          phase: "allocated-disabled",
          distributionId: "E123456789ABCD",
          packageSiteOrigin: "https://d111111abcdef8.cloudfront.net",
          status: "InProgress",
        }),
      );
    const provider = new LambdaOfflineScormCloudFrontProvider(
      "upskill-staging-allocator",
      { send },
    );

    await expect(provider.allocate("entitlement_1")).resolves.toMatchObject({
      phase: "allocated-disabled",
      distributionId: "E123456789ABCD",
    });

    const command = send.mock.calls[0]?.[0];
    if (!(command instanceof InvokeCommand))
      throw new Error("Expected one Lambda invocation");
    expect(command.input.FunctionName).toBe("upskill-staging-allocator");
    expect(command.input.InvocationType).toBe("RequestResponse");
    const payload = command.input.Payload;
    if (!(payload instanceof Uint8Array))
      throw new Error("Expected a binary Lambda invocation payload");
    expect(JSON.parse(Buffer.from(payload).toString("utf8"))).toEqual({
      operation: "allocate",
      entitlementId: "entitlement_1",
    });
  });

  it("rejects function failures and untrusted response origins", async () => {
    const failedProvider = new LambdaOfflineScormCloudFrontProvider(
      "allocator",
      {
        send: vi.fn().mockResolvedValue({
          FunctionError: "Unhandled",
          Payload: Buffer.from("{}"),
        }),
      },
    );
    await expect(
      failedProvider.allocate("entitlement_1"),
    ).rejects.toMatchObject({ code: "allocator_function_error" });

    const forgedProvider = new LambdaOfflineScormCloudFrontProvider(
      "allocator",
      {
        send: vi.fn().mockResolvedValue(
          response({
            phase: "active",
            distributionId: "E123456789ABCD",
            packageSiteOrigin: "https://attacker.example",
            status: "Deployed",
          }),
        ),
      },
    );
    await expect(
      forgedProvider.activate("entitlement_1", "E123456789ABCD"),
    ).rejects.toBeInstanceOf(OfflineScormCloudFrontProviderError);

    const undeployedProvider = new LambdaOfflineScormCloudFrontProvider(
      "allocator",
      {
        send: vi.fn().mockResolvedValue(
          response({
            phase: "active",
            distributionId: "E123456789ABCD",
            packageSiteOrigin: "https://d111111abcdef8.cloudfront.net",
            status: "InProgress",
          }),
        ),
      },
    );
    await expect(
      undeployedProvider.activate("entitlement_1", "E123456789ABCD"),
    ).rejects.toMatchObject({ code: "allocator_response_invalid" });
  });
});
