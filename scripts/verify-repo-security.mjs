import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const csp = fs.readFileSync(
  path.join(root, "src/server/http/security-headers.ts"),
  "utf8",
);

if (
  fs.readFileSync(path.join(root, ".node-version"), "utf8").trim() !== "26.7.0"
)
  failures.push("Node runtime pin must be 26.7.0");
if (packageJson.engines.node !== ">=26 <27")
  failures.push("Node engine must reject non-26 runtimes");
for (const forbidden of [
  "package-lock.json",
  "yarn.lock",
  ".env",
  ".env.local",
]) {
  if (fs.existsSync(path.join(root, forbidden)))
    failures.push(`Forbidden repository file: ${forbidden}`);
}
if (!csp.includes('"script-src-attr": ["\'none\'"]'))
  failures.push("CSP must prohibit script attributes");
if (/script-src[^\n]*unsafe-inline/.test(csp))
  failures.push("CSP script-src must not allow unsafe-inline");
if (!csp.includes('"style-src-attr": ["\'unsafe-inline\'"]'))
  failures.push("Mantine style-attribute exception must stay explicit");
if (!csp.includes("\"style-src-elem\": [\"'self'\", `'nonce-${nonce}'`]"))
  failures.push("Style elements must require the request nonce");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

for (const file of sourceFiles(path.join(root, "src"))) {
  const relative = path.relative(root, file);
  const contents = fs.readFileSync(file, "utf8");
  if (
    /\bstyle\s*=\s*\{\{/.test(contents) ||
    /\bstyles\s*=\s*\{\{/.test(contents)
  )
    failures.push(`Inline React styles are prohibited: ${relative}`);
  const sensitiveImport = /from ['"](?:pg|stripe|kysely|@aws-sdk\/)/.test(
    contents,
  );
  const allowedBoundary =
    relative.includes("/server/") ||
    relative.includes("/migrations/") ||
    relative === "src/server.ts";
  if (sensitiveImport && !allowedBoundary)
    failures.push(`Sensitive dependency outside server boundary: ${relative}`);
}

for (const route of ["ssr: true", 'ssr: "data-only"', "ssr: false"]) {
  const represented = sourceFiles(path.join(root, "src/routes")).some((file) =>
    fs.readFileSync(file, "utf8").includes(route),
  );
  if (!represented)
    failures.push(`Rendering policy is not represented in routes: ${route}`);
}

if (failures.length > 0) throw new Error(failures.join("\n"));
console.log(
  "Verified repository pins, CSP invariants, rendering policy and server boundaries",
);
