import { describe, expect, it } from "vitest";
import {
  lifecyclePlan,
  normalizeListedRecordName,
  requiresRetainedHostDiscovery,
  selectPublicHostedZone,
} from "../lambda/offline-scorm-package-host-lifecycle/index.mjs";

const configured = {
  HostedZoneId: "Z123PACKAGE",
  InstanceId: "i-old",
  LifecycleVersion: "2",
  ParameterName: "/upskill/staging/offline-scorm/package-host-suffix",
  PhysicalResourceId: "upskill-staging-offline-scorm-package-host",
  PublicIp: "203.0.113.10",
  Region: "ap-southeast-2",
  Suffix: "packages.example.net",
};

describe("offline SCORM package-host lifecycle", () => {
  it("normalizes Route 53's escaped wildcard names before exact deletion", () => {
    expect(normalizeListedRecordName("\\052.PACKAGES.EXAMPLE.NET.")).toBe(
      "*.packages.example.net.",
    );
  });

  it("adopts the most specific public zone for a retained suffix", () => {
    expect(
      selectPublicHostedZone("packages.learning.example.net", [
        { Id: "/hostedzone/ZPUBLIC", Name: "example.net." },
        {
          Config: { PrivateZone: true },
          Id: "/hostedzone/ZPRIVATE",
          Name: "learning.example.net.",
        },
        {
          Id: "/hostedzone/ZLEARNING",
          Name: "learning.example.net.",
        },
      ]),
    ).toEqual({ id: "ZLEARNING", name: "learning.example.net" });
  });

  it("forces retained-state discovery for the lifecycle version update", () => {
    expect(
      requiresRetainedHostDiscovery("Update", configured, {
        ...configured,
        LifecycleVersion: undefined,
      }),
    ).toBe(true);
    expect(
      requiresRetainedHostDiscovery("Update", configured, configured),
    ).toBe(false);
  });

  it("retires the old instance before removing package-host infrastructure", () => {
    expect(
      lifecyclePlan(
        "Update",
        { ...configured, HostedZoneId: "", PublicIp: "", Suffix: "" },
        configured,
      ),
    ).toMatchObject({
      cleanupInstanceId: "i-old",
      current: null,
      previous: {
        hostedZoneId: "Z123PACKAGE",
        suffix: "packages.example.net",
      },
    });
  });

  it("retires an adopted native host when the custom provider is created", () => {
    expect(
      lifecyclePlan(
        "Create",
        { ...configured, HostedZoneId: "", PublicIp: "", Suffix: "" },
        configured,
      ),
    ).toMatchObject({
      cleanupInstanceId: "i-old",
      current: null,
      previous: {
        hostedZoneId: "Z123PACKAGE",
        suffix: "packages.example.net",
      },
    });
  });

  it("forces host cleanup when the prior rollout removed adoption evidence", () => {
    const disabled = {
      ...configured,
      HostedZoneId: "",
      PublicIp: "",
      Suffix: "",
    };
    expect(
      lifecyclePlan(
        "Update",
        disabled,
        { ...disabled, LifecycleVersion: undefined },
        true,
      ),
    ).toMatchObject({
      cleanupInstanceId: "i-old",
      current: null,
      previous: null,
    });
  });

  it("retires the old host before suffix rotation", () => {
    expect(
      lifecyclePlan(
        "Update",
        {
          ...configured,
          HostedZoneId: "Z456PACKAGE",
          InstanceId: "i-new",
          Suffix: "packages.example.org",
        },
        configured,
      ),
    ).toMatchObject({
      cleanupInstanceId: "i-old",
      current: {
        hostedZoneId: "Z456PACKAGE",
        suffix: "packages.example.org",
      },
      previous: {
        hostedZoneId: "Z123PACKAGE",
        suffix: "packages.example.net",
      },
    });
  });

  it("updates an unchanged host without unnecessary retirement", () => {
    expect(
      lifecyclePlan(
        "Update",
        { ...configured, PublicIp: "203.0.113.11" },
        configured,
      ),
    ).toMatchObject({ cleanupInstanceId: "", previous: null });
  });

  it("retires a replaced instance without deleting unchanged DNS", () => {
    expect(
      lifecyclePlan(
        "Update",
        { ...configured, InstanceId: "i-new" },
        configured,
      ),
    ).toMatchObject({ cleanupInstanceId: "i-old", previous: null });
  });

  it("retires a configured host before stack deletion", () => {
    expect(lifecyclePlan("Delete", configured)).toMatchObject({
      cleanupInstanceId: "i-old",
      current: null,
      previous: {
        hostedZoneId: "Z123PACKAGE",
        suffix: "packages.example.net",
      },
    });
  });
});
