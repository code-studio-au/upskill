import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const baselineTag = "schema-baseline-v1";
const baselineCommit = "cb80bffde984ba68a71be83808bff4766ac21e58";
const databaseDirectory = path.join(root, "src/server/db");
const migrationsDirectory = path.join(databaseDirectory, "migrations");
const baselinePath = path.join(
  databaseDirectory,
  "migration-baseline-v1.sha256",
);
const baselineSource = await readFile(baselinePath, "utf8");
if (!baselineSource.includes(`# git-tag: ${baselineTag}\n`))
  throw new Error(`Migration baseline must declare ${baselineTag}`);

function gitText(arguments_, failureMessage) {
  try {
    return execFileSync("git", arguments_, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(failureMessage);
  }
}

const resolvedBaselineCommit = gitText(
  ["rev-parse", "--verify", `${baselineTag}^{commit}`],
  `Missing ${baselineTag}; fetch repository tags before verification`,
);
if (resolvedBaselineCommit !== baselineCommit)
  throw new Error(
    `${baselineTag} must resolve to the recorded baseline commit ${baselineCommit}`,
  );
gitText(
  ["merge-base", "--is-ancestor", baselineCommit, "HEAD"],
  `${baselineTag} is not an ancestor of the current commit`,
);

const baselineEntries = baselineSource
  .split(/\r?\n/u)
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => {
    const match = line.match(
      /^([a-f0-9]{64}) {2}(migrations\/([0-9]{4}_[a-z0-9_]+\.ts))$/u,
    );
    if (!match) throw new Error(`Invalid migration baseline entry: ${line}`);
    return { hash: match[1], relativePath: match[2], filename: match[3] };
  });
if (baselineEntries.length === 0)
  throw new Error("Migration baseline must not be empty");

const taggedMigrationPrefix = "src/server/db/migrations/";
const taggedMigrationFiles = gitText(
  ["ls-tree", "-r", "--name-only", baselineTag, "--", taggedMigrationPrefix],
  `Unable to read migrations from ${baselineTag}`,
)
  .split(/\r?\n/u)
  .filter((filename) => filename.endsWith(".ts"))
  .map((filename) => filename.slice("src/server/db/".length))
  .sort();
if (taggedMigrationFiles.length !== baselineEntries.length)
  throw new Error(
    `Baseline manifest has ${baselineEntries.length} migrations but ${baselineTag} has ${taggedMigrationFiles.length}`,
  );

const migrationNumber = (filename) => Number.parseInt(filename.slice(0, 4), 10);
const baselineNames = new Set();
for (const [index, entry] of baselineEntries.entries()) {
  if (baselineNames.has(entry.filename))
    throw new Error(`Duplicate migration baseline entry: ${entry.filename}`);
  baselineNames.add(entry.filename);
  const expectedNumber = index + 1;
  if (migrationNumber(entry.filename) !== expectedNumber)
    throw new Error(
      `Migration baseline must be contiguous at ${entry.filename}; expected ${String(expectedNumber).padStart(4, "0")}`,
    );
  if (taggedMigrationFiles[index] !== entry.relativePath)
    throw new Error(
      `Migration baseline entry ${entry.relativePath} does not match ${baselineTag}`,
    );
  const repositoryPath = `src/server/db/${entry.relativePath}`;
  const taggedSource = execFileSync(
    "git",
    ["show", `${baselineTag}:${repositoryPath}`],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  const taggedHash = createHash("sha256").update(taggedSource).digest("hex");
  if (entry.hash !== taggedHash)
    throw new Error(
      `Migration baseline checksum does not match ${baselineTag}: ${entry.filename}`,
    );
  const source = await readFile(
    path.join(databaseDirectory, entry.relativePath),
  );
  const actualHash = createHash("sha256").update(source).digest("hex");
  if (actualHash !== taggedHash)
    throw new Error(
      `Frozen migration changed: ${entry.filename}. Add a forward-only migration instead`,
    );
}

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((filename) => filename.endsWith(".ts"))
  .sort();
for (const [index, filename] of migrationFiles.entries()) {
  const expectedNumber = index + 1;
  if (!/^[0-9]{4}_[a-z0-9_]+\.ts$/u.test(filename))
    throw new Error(`Invalid migration filename: ${filename}`);
  if (migrationNumber(filename) !== expectedNumber)
    throw new Error(
      `Migrations must remain contiguous; found ${filename}, expected prefix ${String(expectedNumber).padStart(4, "0")}`,
    );
  if (index < baselineEntries.length && !baselineNames.has(filename))
    throw new Error(`Frozen migration was renamed or removed: ${filename}`);
}
if (migrationFiles.length < baselineEntries.length)
  throw new Error("One or more frozen migrations were removed");

const operationalCommunicationMigration = await readFile(
  path.join(migrationsDirectory, "0081_event_operational_communications.ts"),
  "utf8",
);
const operationalScheduleBackfillStart =
  operationalCommunicationMigration.indexOf(
    "insert into event_operational_communication_schedule",
  );
const operationalScheduleBackfillEnd =
  operationalCommunicationMigration.indexOf(
    "`.execute(db);",
    operationalScheduleBackfillStart,
  );
const operationalScheduleBackfill = operationalCommunicationMigration.slice(
  operationalScheduleBackfillStart,
  operationalScheduleBackfillEnd,
);
if (
  operationalScheduleBackfillStart < 0 ||
  operationalScheduleBackfillEnd < 0 ||
  !operationalScheduleBackfill.includes(`occurrence."approvalMode" = 'manual'`)
)
  throw new Error(
    "Event operational schedule backfill must exclude automatic-approval events",
  );

console.log(
  `Verified ${baselineEntries.length} frozen migrations against ${baselineTag} (${baselineCommit}) and ${migrationFiles.length - baselineEntries.length} forward-only migration(s)`,
);
