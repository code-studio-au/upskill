<!-- upskill-pr-preflight:v1 -->

## Outcome

<!-- State the user or operational outcome, not a list of files changed. -->

## Scope and decisions

<!--
Describe the bounded delivery slice and its important implementation decisions.
If this combines multiple privileged capabilities, state machines, asynchronous
pipelines or primary actor journeys, explain why it cannot be safely split.
-->

## Cross-cutting impact

<!--
Classify this as cross-cutting, bounded or documentation-only. Record the
impact-matrix delta for applicable actors, entry paths, targets, lifecycle states,
qualification, outcomes, downstream effects, failure modes and concurrency.
Use an explicit "Not applicable" rationale for dimensions that do not apply.
-->

## Verification

<!-- List the exact commands completed on this head and their outcomes. -->

## Deployment and operations

<!--
Describe migrations, feature flags, compatibility, secrets/configuration,
observability, rollout and rollback considerations. State "Not applicable" with
a reason when there is no deployment or operational effect.
-->

## Review readiness

Check every control. A checked control means it is complete or its corresponding
section contains an explicit not-applicable rationale.

- [ ] This is one independently safe, reviewable slice, or the scope section justifies why it must be combined. <!-- upskill-preflight:bounded-scope -->
- [ ] The applicable actors, entry paths, targets, lifecycle states and downstream effects are covered in the impact-matrix delta. <!-- upskill-preflight:impact-matrix -->
- [ ] One server-owned policy or state-transition boundary owns each affected business decision. <!-- upskill-preflight:central-policy -->
- [ ] Equivalent capability grants, callers and downstream consumers were searched and audited. <!-- upskill-preflight:consumer-audit -->
- [ ] Negative, malicious, stale-state, retry and concurrency cases have focused coverage where applicable. <!-- upskill-preflight:negative-coverage -->
- [ ] The verification section reports only commands completed successfully on this exact head. <!-- upskill-preflight:exact-head-verification -->
- [ ] Authorization, validation, immutable evidence, CSP, accessibility, responsive layout, bundle, migration and secret risks were reviewed where applicable. <!-- upskill-preflight:risk-review -->
- [ ] Existing review findings, if any, were repaired across their invariant category rather than only at the commented line. <!-- upskill-preflight:category-sweep -->
- [ ] Deployment, migration, configuration, monitoring and rollback effects are stated, including an explicit reason for any not-applicable item. <!-- upskill-preflight:operations -->
