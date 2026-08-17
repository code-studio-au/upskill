# ADR 0033: Forward-only Survey branching

## Status

Accepted and implemented.

## Context

Surveys sometimes need to omit irrelevant sections. User Onboarding, for
example, asks whether a User works in a region. A Yes answer continues through
Region Group and Operational Region questions, while No bypasses that section.
The same need applies to learning and event Surveys, so it must not be an
Onboarding-only rule.

## Decision

Single choice and Dropdown answers may optionally continue at a selected later
Survey Section. The administrator configures this under the question's
Conditional logic controls by selecting an existing later section for each
answer. An answer without a target continues in document order.

Targets are forward-only. A target must identify a section in the same exact
Survey Version and must occur after the question's section. Multiple choice
answers cannot branch because simultaneous answers would make the next path
ambiguous. These constraints prevent loops and make the path deterministic.

Published Survey Versions retain answer option IDs and their target Section IDs.
The server derives the reachable item path from the pinned Survey Version and
stored answers. Skipped items do not count towards progress or completion and
cannot be submitted directly. When an earlier answer changes, answers and view
evidence for items no longer on the reachable path are removed from the active
draft before completion. Historical submitted responses remain immutable.

For Onboarding profile projection, skipping a mapped optional Region question
sets the current Region to no region. Existing Event Registration Region
Snapshots remain unchanged under ADR 0022 and the Events domain rules.

## Consequences

- The same branching model works for learning, event and onboarding Surveys.
- The designer exposes only valid later sections and clears invalid targets
  after section removal or reordering.
- Learner navigation, server validation, progress and completion use one shared
  path calculation.
- Arbitrary expressions, backward jumps, cross-Survey targets and branching
  from Multiple choice are deliberately unsupported.
