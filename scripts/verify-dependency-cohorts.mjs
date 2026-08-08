import fs from "node:fs";

const root = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const cdk = JSON.parse(
  fs.readFileSync(
    new URL("../deploy/cdk/package.json", import.meta.url),
    "utf8",
  ),
);
const policy = JSON.parse(
  fs.readFileSync(
    new URL("../config/dependency-cohorts.json", import.meta.url),
    "utf8",
  ),
);
const workspace = fs.readFileSync(
  new URL("../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);
const all = { ...root.dependencies, ...root.devDependencies };
const failures = [];

for (const [name, version] of Object.entries(all)) {
  if (/^[~^*><=]|\s\|\|\s/.test(version))
    failures.push(`${name} is not exact-pinned: ${version}`);
}
for (const cohort of policy.sameVersion) {
  const versions = cohort.map((name) => all[name]);
  if (versions.some((version) => !version))
    failures.push(`Missing cohort member: ${cohort.join(", ")}`);
  if (new Set(versions).size !== 1)
    failures.push(
      `Cohort drift: ${cohort.map((name, index) => `${name}@${versions[index]}`).join(", ")}`,
    );
}
if (workspace.includes("minimumReleaseAge"))
  failures.push(
    "Dependency release-age delay must remain disabled by ADR 0006",
  );
if (root.packageManager !== "pnpm@11.0.8")
  failures.push("pnpm packageManager pin drifted");
if (root.devDependencies["@typescript/native"] !== "npm:typescript@7.0.2")
  failures.push("TypeScript 7 must remain authoritative");
if (root.devDependencies.typescript !== "npm:@typescript/typescript6@6.0.2")
  failures.push("TypeScript 6 compatibility alias drifted");
if (cdk.dependencies["aws-cdk-lib"] !== "2.263.0")
  failures.push("CDK library cohort drifted");

if (failures.length > 0) throw new Error(failures.join("\n"));
console.log(
  `Verified ${Object.keys(all).length} exact-pinned root dependencies and ${policy.sameVersion.length} cohorts`,
);
