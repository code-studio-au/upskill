# ADR 0034: Source-neutral course entitlements and Access Owner disclosure

## Status

Accepted and implemented for course enrolments produced by individual checkout,
access-grant redemption, and administrator assignment. Enterprise contracts,
blanket coverage, and customer capacity-extension Checkout remain future work.
Shared-code and generated single-use-code fulfilment are implemented for finite
bulk and enterprise access grants.

## Context

An enrolment records participation in one exact learning version, but it does
not by itself explain why access was granted. Inferring the commercial origin
from nullable enrolment or access-grant fields would couple reporting and
customer self-service to the current purchase mechanism.

Bulk purchasers and enterprise access owners also need a narrow view of the
learners who used their allocation. That view includes personal information and
progress, so possession of a code alone must neither grant owner access nor
silently disclose a learner's data.

## Decision

Every newly issued course enrolment has one source-neutral `entitlement` record.
It identifies the exact learner, course version and enrolment, and one origin:
access grant, order, or administrator. Existing enrolments are backfilled at the
migration boundary. Checkout, access-code redemption and administrator
assignment share the same transactional entitlement-to-enrolment issuer.

An administrator-created bulk or enterprise access grant records one or more
Access Owner email assignments. A new email provisions the existing soft-account
and setup-email workflow. Capability activates only for the verified account
whose normalized email and user identity match the unrevoked assignment.
Assignments grant no platform or organisation-wide administration.

Each finite grant chooses one fulfilment mode at creation: one reusable shared
code, or one generated single-use code per purchased enrolment. Codes are
first-class encrypted child records of the grant. A single-use redemption records
the exact code origin on the entitlement, preventing reuse while preserving the
common grant capacity lock and learner consent path. Increasing batch capacity
appends new numbered codes and never changes or withdraws codes already supplied
to the customer.

Access-code redemption is two-step. The first request resolves eligibility and
shows the provider and course without consuming capacity. The second request
requires an explicit information-release acknowledgement. The entitlement
retains the accepted notice version, acceptance time, and point-in-time
redemption email.

An Access Owner query starts from an active assignment and traverses only
entitlements originating from that exact grant. It includes only learners who
accepted the information-release notice and exposes name, redemption email,
course, bounded progress and completion. It excludes survey answers, detailed
SCORM state, unrelated learning and broader profile data. Shared-code reveal,
single-use batch CSV export and learner CSV export are separately authorized and
audited. The batch export includes each code's availability or redemption state
and point-in-time learner attribution.

## Consequences

- Commercial sources can evolve without changing learning evidence models.
- A later email change cannot rewrite the email used at redemption.
- Access Owner revocation can remove future customer access without changing
  learner entitlements or history.
- Grant capacity remains serialized by the existing row lock.
- Customer-extendable grants are now distinguishable, but increasing capacity
  still requires the future Stripe order/webhook workflow before an owner-facing
  purchase action is exposed.
- Event and enterprise-contract entitlements can extend the origin/scope model
  through later migrations without overloading course enrolment semantics.
