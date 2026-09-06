import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  requiredPreflightControls,
  validatePullRequestBody,
} from "./verify-pull-request-description.mjs";

function validBody() {
  const controls = requiredPreflightControls
    .map(
      (control) =>
        `- [x] Completed ${control}. <!-- upskill-preflight:${control} -->`,
    )
    .join("\n");
  return `<!-- upskill-pr-preflight:v1 -->

## Outcome

The intended user outcome is complete.

## Scope and decisions

This is one independently reviewable delivery slice.

## Cross-cutting impact

Bounded change; affected callers and lifecycle states are listed.

## Verification

The focused verification command completed successfully.

## Deployment and operations

Not applicable because this change has no runtime effect.

## Review readiness

${controls}
`;
}

describe("pull-request description preflight", () => {
  it("accepts a completed repository template", () => {
    expect(validatePullRequestBody(validBody())).toEqual([]);
  });

  it("rejects missing content and unchecked controls in the raw template", async () => {
    const template = await readFile(
      new URL("../.github/pull_request_template.md", import.meta.url),
      "utf8",
    );
    const errors = validatePullRequestBody(template);

    expect(errors).toContain(
      "Complete ## Outcome with evidence or an explicit not-applicable rationale.",
    );
    expect(errors).toContain("Preflight control is not checked: bounded-scope");
    expect(errors).toHaveLength(14);
  });

  it("rejects deletion of a required control", () => {
    const body = validBody().replace(
      /^.*upskill-preflight:consumer-audit.*\n/mu,
      "",
    );

    expect(validatePullRequestBody(body)).toContain(
      "Missing required preflight control: consumer-audit",
    );
  });
});
