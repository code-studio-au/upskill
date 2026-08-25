import { execFileSync } from "node:child_process";
import { Client } from "pg";
import dispatchableOutboxTopics from "../config/dispatchable-outbox-topics.json" with { type: "json" };

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
        (select count(*) from sms_delivery where status = 'unknown'))::integer as "uncertainDeliveries"`,
    [dispatchableOutboxTopics],
  );
  row = result.rows[0];
} finally {
  await database.end();
}
const outboxPending = row?.outboxPending ?? 0;
const outboxOldestSeconds = Math.max(row?.outboxOldestSeconds ?? 0, 0);
const uncertainDeliveries = row?.uncertainDeliveries ?? 0;

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
];
execFileSync("aws", [
  "cloudwatch",
  "put-metric-data",
  "--namespace",
  "Upskill",
  "--metric-data",
  JSON.stringify(metricData),
]);
