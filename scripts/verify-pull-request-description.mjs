import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const requiredSections = [
  "Outcome",
  "Scope and decisions",
  "Cross-cutting impact",
  "Verification",
  "Deployment and operations",
];

export const requiredPreflightControls = [
  "bounded-scope",
  "impact-matrix",
  "central-policy",
  "consumer-audit",
  "negative-coverage",
  "exact-head-verification",
  "risk-review",
  "category-sweep",
  "operations",
];

const escapeRegularExpression = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

function visibleSectionContent(body, heading) {
  const headingPattern = new RegExp(
    `^## ${escapeRegularExpression(heading)}\\s*$`,
    "mu",
  );
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) return null;

  const contentStart = headingMatch.index + headingMatch[0].length;
  const remainingBody = body.slice(contentStart);
  const nextHeadingOffset = remainingBody.search(/^##\s+/mu);
  const section =
    nextHeadingOffset === -1
      ? remainingBody
      : remainingBody.slice(0, nextHeadingOffset);

  return section
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/^- \[[ xX]\].*$/gmu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function validatePullRequestBody(body) {
  const errors = [];
  if (typeof body !== "string" || body.trim() === "")
    return ["Pull-request description is empty."];

  if (!body.includes("<!-- upskill-pr-preflight:v1 -->"))
    errors.push(
      "Use the repository pull-request template; its preflight marker is missing.",
    );

  for (const heading of requiredSections) {
    const content = visibleSectionContent(body, heading);
    if (content === null) {
      errors.push(`Missing required section: ## ${heading}`);
      continue;
    }
    if (content.length < 10)
      errors.push(
        `Complete ## ${heading} with evidence or an explicit not-applicable rationale.`,
      );
  }

  for (const control of requiredPreflightControls) {
    const controlPattern = new RegExp(
      `^- \\[([ xX])\\][^\\n]*<!--\\s*upskill-preflight:${escapeRegularExpression(control)}\\s*-->\\s*$`,
      "mu",
    );
    const controlMatch = controlPattern.exec(body);
    if (!controlMatch) {
      errors.push(`Missing required preflight control: ${control}`);
      continue;
    }
    if (controlMatch[1].toLowerCase() !== "x")
      errors.push(`Preflight control is not checked: ${control}`);
  }

  return errors;
}

async function pullRequestBodyFromArguments() {
  const bodyFileIndex = process.argv.indexOf("--body-file");
  if (bodyFileIndex !== -1) {
    const bodyFile = process.argv[bodyFileIndex + 1];
    if (!bodyFile) throw new Error("--body-file requires a path");
    return readFile(path.resolve(bodyFile), "utf8");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath)
    throw new Error(
      "GITHUB_EVENT_PATH is unavailable; pass --body-file for local verification",
    );
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  if (!event.pull_request)
    throw new Error("GitHub event does not contain a pull request");
  return event.pull_request.body ?? "";
}

async function main() {
  const errors = validatePullRequestBody(await pullRequestBodyFromArguments());
  if (errors.length > 0) {
    console.error("Pull-request preflight failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Verified pull-request description and preflight controls");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
