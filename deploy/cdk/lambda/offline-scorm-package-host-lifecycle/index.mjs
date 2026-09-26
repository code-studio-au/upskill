const PACKAGE_VHOST_PATH = "/etc/nginx/conf.d/upskill-package-site.conf";
const RECONCILER_PATH = "/usr/local/bin/upskill-reconcile-package-site-vhost";
const DNS_SUFFIX =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function property(properties, name) {
  const value = properties?.[name];
  return typeof value === "string" ? value : "";
}

function configuredHost(properties) {
  const hostedZoneId = property(properties, "HostedZoneId");
  const publicIp = property(properties, "PublicIp");
  const suffix = property(properties, "Suffix");
  return hostedZoneId && publicIp && suffix
    ? { hostedZoneId, publicIp, suffix }
    : null;
}

export function lifecyclePlan(requestType, resourceProperties, oldProperties) {
  const current =
    requestType === "Delete" ? null : configuredHost(resourceProperties);
  const previous = configuredHost(
    requestType === "Delete" ? resourceProperties : oldProperties,
  );
  const currentInstanceId = property(resourceProperties, "InstanceId");
  const previousInstanceId = property(
    requestType === "Delete" ? resourceProperties : oldProperties,
    "InstanceId",
  );
  const cleanupRequired = Boolean(
    previous &&
    (!current ||
      previous.suffix !== current.suffix ||
      previous.hostedZoneId !== current.hostedZoneId ||
      previousInstanceId !== currentInstanceId),
  );

  return {
    cleanupInstanceId: cleanupRequired ? previousInstanceId : "",
    current,
    parameterName: property(resourceProperties, "ParameterName"),
    previous:
      previous &&
      (!current ||
        previous.suffix !== current.suffix ||
        previous.hostedZoneId !== current.hostedZoneId)
        ? previous
        : null,
    region: property(resourceProperties, "Region"),
  };
}

let modulesPromise;
async function awsModules() {
  modulesPromise ??= Promise.all([
    import("@aws-sdk/client-route-53"),
    import("@aws-sdk/client-ssm"),
  ]);
  const [route53, ssm] = await modulesPromise;
  return { route53, ssm };
}

async function startCleanup(plan, clientToken) {
  if (!plan.cleanupInstanceId) return "";
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(clientToken))
    throw new Error(
      "CloudFormation request ID is not a valid SSM client token",
    );
  const { ssm } = await awsModules();
  const client = new ssm.SSMClient({ region: plan.region });
  const command = await client.send(
    new ssm.SendCommandCommand({
      ClientToken: clientToken,
      DocumentName: "AWS-RunShellScript",
      InstanceIds: [plan.cleanupInstanceId],
      Parameters: {
        commands: [
          "set -euo pipefail",
          `if [[ -x ${RECONCILER_PATH} ]]; then ${RECONCILER_PATH} "" true; elif [[ -e ${PACKAGE_VHOST_PATH} ]]; then echo "Package vhost exists without its reconciler" >&2; exit 1; fi`,
        ],
      },
      TimeoutSeconds: 300,
    }),
  );
  const commandId = command.Command?.CommandId;
  if (!commandId)
    throw new Error("SSM did not return a package-host cleanup command ID");
  return commandId;
}

async function cleanupComplete(plan, commandId) {
  if (!commandId) return true;
  const { ssm } = await awsModules();
  const client = new ssm.SSMClient({ region: plan.region });
  let invocation;
  try {
    invocation = await client.send(
      new ssm.GetCommandInvocationCommand({
        CommandId: commandId,
        InstanceId: plan.cleanupInstanceId,
      }),
    );
  } catch (error) {
    if (error?.name === "InvocationDoesNotExist") return false;
    throw error;
  }
  switch (invocation.Status) {
    case "Pending":
    case "InProgress":
    case "Delayed":
      return false;
    case "Success":
      return true;
    default:
      throw new Error(
        `Package-host cleanup command failed with status ${invocation.Status ?? "Unknown"}`,
      );
  }
}

function recordName(suffix) {
  return `*.${suffix}.`;
}

export function normalizeListedRecordName(name) {
  return name.replace(/^\\052\./u, "*.").toLowerCase();
}

function normalizedZoneName(name) {
  return typeof name === "string" ? name.replace(/\.$/u, "").toLowerCase() : "";
}

function matchingPublicHostedZones(suffix, hostedZones) {
  return hostedZones
    .filter((zone) => zone.Config?.PrivateZone !== true)
    .map((zone) => ({
      id:
        typeof zone.Id === "string"
          ? zone.Id.replace(/^\/hostedzone\//u, "")
          : "",
      name: normalizedZoneName(zone.Name),
    }))
    .filter(
      (zone) =>
        zone.id &&
        zone.name &&
        (suffix === zone.name || suffix.endsWith(`.${zone.name}`)),
    )
    .sort((left, right) => right.name.length - left.name.length);
}

export function selectPublicHostedZone(suffix, hostedZones) {
  return matchingPublicHostedZones(suffix, hostedZones)[0] ?? null;
}

async function discoverRetainedHost(properties) {
  const parameterName = property(properties, "ParameterName");
  if (!parameterName) return null;
  const { route53, ssm } = await awsModules();
  const ssmClient = new ssm.SSMClient({
    region: property(properties, "Region"),
  });
  let parameter;
  try {
    parameter = await ssmClient.send(
      new ssm.GetParameterCommand({ Name: parameterName }),
    );
  } catch (error) {
    if (error?.name === "ParameterNotFound") return null;
    throw error;
  }
  const suffix = parameter.Parameter?.Value;
  if (typeof suffix !== "string" || !DNS_SUFFIX.test(suffix))
    throw new Error(
      `Retained package-host parameter ${parameterName} has an invalid suffix`,
    );

  const route53Client = new route53.Route53Client({
    region: property(properties, "Region"),
  });
  const hostedZones = [];
  let marker;
  do {
    const page = await route53Client.send(
      new route53.ListHostedZonesCommand(marker ? { Marker: marker } : {}),
    );
    hostedZones.push(...(page.HostedZones ?? []));
    marker = page.IsTruncated ? page.NextMarker : undefined;
  } while (marker);
  const matchingRecords = [];
  for (const zone of matchingPublicHostedZones(suffix, hostedZones)) {
    const listed = await route53Client.send(
      new route53.ListResourceRecordSetsCommand({
        HostedZoneId: zone.id,
        MaxItems: 1,
        StartRecordName: recordName(suffix),
        StartRecordType: "A",
      }),
    );
    const record = listed.ResourceRecordSets?.[0];
    if (
      record?.Name &&
      normalizeListedRecordName(record.Name) === recordName(suffix) &&
      record.Type === "A"
    )
      matchingRecords.push(zone);
  }
  if (matchingRecords.length !== 1)
    throw new Error(
      `Expected exactly one retained package-host record for ${suffix}; found ${matchingRecords.length}`,
    );
  const [zone] = matchingRecords;

  return {
    ...properties,
    HostedZoneId: zone.id,
    PublicIp: property(properties, "PublicIp") || "retained-record",
    Suffix: suffix,
  };
}

async function deleteRecord(route53Client, route53, host) {
  const listed = await route53Client.send(
    new route53.ListResourceRecordSetsCommand({
      HostedZoneId: host.hostedZoneId,
      MaxItems: 1,
      StartRecordName: recordName(host.suffix),
      StartRecordType: "A",
    }),
  );
  const record = listed.ResourceRecordSets?.[0];
  if (
    !record?.Name ||
    normalizeListedRecordName(record.Name) !== recordName(host.suffix) ||
    record.Type !== "A"
  )
    return;
  await route53Client.send(
    new route53.ChangeResourceRecordSetsCommand({
      HostedZoneId: host.hostedZoneId,
      ChangeBatch: {
        Changes: [{ Action: "DELETE", ResourceRecordSet: record }],
      },
    }),
  );
}

async function applyPlan(plan) {
  const { route53, ssm } = await awsModules();
  const route53Client = new route53.Route53Client({ region: plan.region });
  const ssmClient = new ssm.SSMClient({ region: plan.region });

  if (plan.previous) await deleteRecord(route53Client, route53, plan.previous);

  if (plan.current) {
    await ssmClient.send(
      new ssm.PutParameterCommand({
        Name: plan.parameterName,
        Type: "String",
        Value: plan.current.suffix,
        Description:
          "Provisioned wildcard package-host suffix; runtime activation must use the same private PSL suffix",
        Overwrite: true,
      }),
    );
    await route53Client.send(
      new route53.ChangeResourceRecordSetsCommand({
        HostedZoneId: plan.current.hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: "UPSERT",
              ResourceRecordSet: {
                Name: recordName(plan.current.suffix),
                Type: "A",
                TTL: 60,
                ResourceRecords: [{ Value: plan.current.publicIp }],
              },
            },
          ],
        },
      }),
    );
    return;
  }

  try {
    await ssmClient.send(
      new ssm.DeleteParameterCommand({ Name: plan.parameterName }),
    );
  } catch (error) {
    if (error?.name !== "ParameterNotFound") throw error;
  }
}

export async function onEvent(event) {
  const retainedProperties =
    event.RequestType === "Create"
      ? await discoverRetainedHost(event.ResourceProperties)
      : null;
  const plan = lifecyclePlan(
    event.RequestType,
    event.ResourceProperties,
    retainedProperties ?? event.OldResourceProperties,
  );
  return {
    PhysicalResourceId: property(
      event.ResourceProperties,
      "PhysicalResourceId",
    ),
    Data: {
      CommandId: await startCleanup(plan, property(event, "RequestId")),
      Plan: JSON.stringify(plan),
    },
  };
}

export async function isComplete(event) {
  const plan = JSON.parse(event.Data.Plan);
  if (!(await cleanupComplete(plan, event.Data.CommandId)))
    return { IsComplete: false };
  await applyPlan(plan);
  return { IsComplete: true };
}
