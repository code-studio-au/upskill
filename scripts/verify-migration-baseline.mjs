import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const databaseDirectory = path.join(root, "src/server/db");
const migrationsDirectory = path.join(databaseDirectory, "migrations");
const baselinePath = path.join(
  databaseDirectory,
  "migration-baseline-v1.sha256",
);
const baselineSource = await readFile(baselinePath, "utf8");
const tagMatch = baselineSource.match(
  /^# git-tag: (schema-baseline-v[1-9][0-9]*)$/mu,
);
if (!tagMatch)
  throw new Error("Migration baseline must declare its release tag");

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
  const source = await readFile(
    path.join(databaseDirectory, entry.relativePath),
  );
  const actualHash = createHash("sha256").update(source).digest("hex");
  if (actualHash !== entry.hash)
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

console.log(
  `Verified ${baselineEntries.length} frozen migrations at ${tagMatch[1]} and ${migrationFiles.length - baselineEntries.length} forward-only migration(s)`,
);
