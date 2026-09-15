import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { EgressStatus, LiveKitAPI } from "livekit-server-sdk";
import { Client } from "pg";
import dispatchableOutboxTopics from "../config/dispatchable-outbox-topics.json" with { type: "json" };
import {
  liveKitOperationalMetricValues,
  parseLiveKitSpendObservation,
} from "../src/server/livekit/livekit-operational-metrics.ts";

const spendObservationPath =
  "/opt/upskill/shared/livekit-spend-observation.json";

const [readyValue, workerValue] = process.argv.slice(2);
const environment = process.env.APP_ENV;
const databaseUrl = process.env.DATABASE_URL;
if (!environment || !databaseUrl)
  throw new Error("APP_ENV and DATABASE_URL are required for metrics");

const database = new Client({ connectionString: databaseUrl });
let row;
try {
  await database.connect();
  const result = await database.query(
    `select
      (select count(*)::integer from outbox_event where "processedAt" is null and topic = any($1::text[])) as "outboxPending",
      (select coalesce(extract(epoch from now() - min("availableAt")), 0)::integer from outbox_event where "processedAt" is null and topic = any($1::text[]) and "availableAt" <= now()) as "outboxOldestSeconds",
      ((select count(*) from notification where status = 'unknown') +
        (select count(*) from sms_delivery where status = 'unknown'))::integer as "uncertainDeliveries",
      (select count(*)::integer
        from audit_event
        where action in (
          'event_virtual_lobby.attendee_token_denied',
          'event_virtual_room.presenter_token_denied'
        )
          and reason in ('capacity_reached', 'capacity_exceeded')
          and "createdAt" >= now() - interval '10 minutes') as "liveKitCapacityDenials",
      (select count(*)::integer
        from event_virtual_recording
        where status = 'failed'
          and "updatedAt" >= now() - interval '10 minutes') as "liveKitManagedEgressFailures"`,
    [dispatchableOutboxTopics],
  );
  row = result.rows[0];
} finally {
  await database.end();
}
const outboxPending = row?.outboxPending ?? 0;
const outboxOldestSeconds = Math.max(row?.outboxOldestSeconds ?? 0, 0);
const uncertainDeliveries = row?.uncertainDeliveries ?? 0;
const liveKitCapacityDenials = row?.liveKitCapacityDenials ?? 0;
const liveKitManagedEgressFailures = row?.liveKitManagedEgressFailures ?? 0;

const liveKitEnabled = process.env.LIVEKIT_ENABLED === "true";
const requiredPositiveInteger = (name) => {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(
      `${name} must be a positive integer when LiveKit is enabled`,
    );
  return value;
};
let providerAvailable = !liveKitEnabled;
let activeRooms = 0;
let connectedParticipants = 0;
let activeEgressJobs = 0;
let approvedMaxConcurrentRooms = 1;
let approvedMaxConcurrentParticipants = 1;
let approvedMaxConcurrentEgressJobs = 1;
if (liveKitEnabled) {
  approvedMaxConcurrentRooms = requiredPositiveInteger(
    "LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS",
  );
  approvedMaxConcurrentParticipants = requiredPositiveInteger(
    "LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS",
  );
  approvedMaxConcurrentEgressJobs = requiredPositiveInteger(
    "LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS",
  );
  try {
    const api = new LiveKitAPI({
      host: process.env.LIVEKIT_URL,
      apiKey: process.env.LIVEKIT_API_KEY,
      secret: process.env.LIVEKIT_API_SECRET,
      requestTimeout: 10,
    });
    const [rooms, egressJobs] = await Promise.all([
      api.room.listRooms(),
      api.egress.listEgress({ active: true }),
    ]);
    activeRooms = rooms.length;
    connectedParticipants = rooms.reduce(
      (total, room) => total + room.numParticipants,
      0,
    );
    activeEgressJobs = egressJobs.filter((job) =>
      [
        EgressStatus.EGRESS_STARTING,
        EgressStatus.EGRESS_ACTIVE,
        EgressStatus.EGRESS_ENDING,
      ].includes(job.status),
    ).length;
    providerAvailable = true;
  } catch (error) {
    void error;
    console.error("LiveKit operational probe failed");
  }
}

let spendObservation = null;
try {
  spendObservation = parseLiveKitSpendObservation(
    JSON.parse(await readFile(spendObservationPath, "utf8")),
  );
} catch (error) {
  if (error?.code !== "ENOENT")
    console.error(
      "LiveKit spend observation is unreadable",
      error instanceof Error ? error.message : "unknown error",
    );
}
const liveKitMetrics = liveKitOperationalMetricValues({
  enabled: liveKitEnabled,
  providerAvailable,
  activeRooms,
  connectedParticipants,
  activeEgressJobs,
  capacityDenials: liveKitCapacityDenials,
  managedEgressFailures: liveKitManagedEgressFailures,
  approvedMaxConcurrentRooms,
  approvedMaxConcurrentParticipants,
  approvedMaxConcurrentEgressJobs,
  spendObservation,
  now: new Date(),
});

const dimensions = [{ Name: "Environment", Value: environment }];
const metricData = [
  {
    MetricName: "ApplicationReady",
    Unit: "Count",
    Value: Number(readyValue),
    Dimensions: dimensions,
  },
  {
    MetricName: "WorkerActive",
    Unit: "Count",
    Value: Number(workerValue),
    Dimensions: dimensions,
  },
  {
    MetricName: "OutboxPending",
    Unit: "Count",
    Value: outboxPending,
    Dimensions: dimensions,
  },
  {
    MetricName: "OutboxOldestSeconds",
    Unit: "Seconds",
    Value: outboxOldestSeconds,
    Dimensions: dimensions,
  },
  {
    MetricName: "UncertainDeliveries",
    Unit: "Count",
    Value: uncertainDeliveries,
    Dimensions: dimensions,
  },
  ...Object.entries(liveKitMetrics).map(([MetricName, Value]) => ({
    MetricName,
    Unit: MetricName.endsWith("Percent")
      ? "Percent"
      : MetricName === "LiveKitMonthlySpendAud"
        ? "None"
        : "Count",
    Value,
    Dimensions: dimensions,
  })),
];
execFileSync("aws", [
  "cloudwatch",
  "put-metric-data",
  "--namespace",
  "Upskill",
  "--metric-data",
  JSON.stringify(metricData),
]);
