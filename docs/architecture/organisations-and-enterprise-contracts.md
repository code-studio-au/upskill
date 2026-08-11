# Organisations and Enterprise Contracts

**Status:** Living domain design document\
**Scope:** Organisation identity, customer relationships, bulk-seat
access, blanket enterprise agreements, eligibility, utilisation,
administration, and entitlement integration

## Purpose

This document defines how Upskill should model healthcare organisations
and large contractual customers as the platform grows beyond
course-specific access codes.

The central rule is:

> **An organisation or enterprise agreement establishes commercial
> eligibility and access rights; it does not become a parallel learning
> system.**

The model must support both a clinic purchasing 20 seats in one course
and a government health entity purchasing broad annual access for its
eligible workforce.

## Architecture Horizons

- **Current Product:** organisation identity/membership plus course-specific,
  capacity-limited access grants with optional verified-domain eligibility.
- **Target Product:** first-class enterprise contracts, covered-offering scope,
  eligibility rules, effective periods, source-neutral entitlements and scoped
  Access Owner self-service for assigned grants/contracts.
- **Future Possibilities:** SSO-backed eligibility, complex coverage versions
  and organisation/event reporting at demonstrated scale.

## Product Context

Upskill currently sells professional education through the first two pathways
below. The third is the Target Product commercial model:

1.  individuals purchasing their own learning;
2.  healthcare organisations purchasing fixed quantities of course
    access for staff; and
3.  enterprise/government customers purchasing broad contractual
    coverage.

Organisation support is therefore not merely an address-book feature. It
is part of the commercial entitlement model.

## Current Product

The repository already contains organisation-aware access grants and
organisation membership/role concepts. Access grants can represent an
exact published course version, capacity, redeemed quantity, enrolment
duration, expiry, revocation, and optional verified-email-domain
restrictions.

This works well for a customer buying a fixed number of places in one
course.

The gap appears when a contract means something broader, for example:

```text
NSW Health
  -> annual agreement
  -> all eligible staff
  -> all covered Upskill courses
  -> no individual learner payment
```

Representing this only as many unrelated course-specific grants would
duplicate contract policy and make renewals/reporting harder.

## Target Product

The following boundaries describe the accepted direction. Only the organisation
and course-specific access-grant subset exists today.

## Domain Boundaries

### Organisations own

- customer organisation identity;
- organisation metadata;
- organisation membership where required;
- organisation-local roles where useful;
- verified eligibility domains/rules;
- relationships to purchases, grants, and contracts; and
- organisation-level utilisation views.

### Enterprise Contracts own

- commercial agreement identity;
- effective/expiry/renewal period;
- contract status;
- covered learning scope;
- eligibility rules;
- unlimited/capped usage rules;
- commercial/customer reference metadata;
- administrative ownership; and
- audit history.

### Entitlements own

The actual right that allows an eligible individual to access defined
learning.

### Learning owns

Enrolments, progress, completion, and certificates. Learning never needs
to understand contract pricing or procurement terms.

## Core Concepts

### Organisation

A stable business/customer entity such as a healthcare provider, clinic,
hospital network, or government health organisation.

Organisation identity should remain stable even as contracts, staff,
domains, and purchases change.

### Organisation Membership

A relationship between a user and organisation where product workflows
require persistent membership.

Do not require membership merely to redeem a one-off organisation access
code unless there is a product reason to create that relationship.

### Organisation Role

Organisation-local responsibilities such as owner, administrator,
manager, or learner may use a simple hierarchy where that hierarchy is
genuinely meaningful.

Organisation roles should not implicitly grant unrelated platform or
event roles.

### Enterprise Contract

A stable record of a commercial agreement granting an organisation
access over a period.

A contract should be capable of representing:

- organisation;
- contract/reference number;
- effective date;
- expiry/renewal date;
- status;
- coverage model;
- learning scope;
- eligibility rules;
- capacity/usage policy;
- enrolment duration/access policy;
- internal account owner; and
- audit history.

### Contract Coverage

Defines what the agreement covers.

Possible scopes include:

```text
one course
set of courses
all currently eligible courses
specific events
course + event bundle
future product-defined collection
```

Coverage should be represented explicitly rather than encoded into
conditional code paths.

### Eligibility Rule

Defines who may claim access under the agreement.

Initial rules may include verified email domains. Future requirements
could include pre-provisioned employee lists, SSO organisation identity,
invitation, or other contract-specific eligibility mechanisms.

### Organisation Access Code

A human-readable credential that can identify an access grant or
enterprise eligibility pathway.

The code is not the contract itself. Codes can be rotated/revoked
without changing contract identity or historical entitlements.

### Utilisation

The measurable use of purchased/contracted access, for example seats
redeemed, active learners, enrolments, completions, or event
registrations.

Utilisation is reporting over authoritative access/learning records
rather than a separate source of truth.

## Fixed-Seat Organisation Purchase

The existing grant model remains appropriate for cases such as:

```text
Organisation buys 20 seats in Course A
  -> capacity-backed access grant
  -> code issued
  -> staff redeem code
  -> each redemption consumes one place
  -> exact-version enrolment created
```

Important invariants:

- redemption cannot exceed capacity;
- concurrency is transactionally serialized;
- expiry/revocation blocks future redemption;
- previous learning history remains intact; and
- the grant remains traceable to the organisation/commercial source.

## Blanket Enterprise Agreement

A blanket contract should work differently from a finite seat pool.

```text
Enterprise contract active
  -> learner presents organisation eligibility
  -> eligibility verified
  -> requested offering checked against contract coverage
  -> individual entitlement materialised
  -> exact learning version resolved
  -> enrolment created
```

The platform should not pre-create thousands of enrolments merely
because thousands of staff are eligible.

Materialise individual access when an eligible person actually selects
learning, unless contractual/reporting requirements require
pre-provisioning.

## Shared Code Model

A shared enterprise code can be a practical eligibility entry point.

Recommended flow:

1.  learner authenticates;
2.  submits enterprise code;
3.  code resolves to active contract/access rule;
4.  identity eligibility is checked (for example verified email domain);
5.  learner gains access to covered catalogue/offering selection; and
6.  individual entitlements/enrolments are created as learning is
    selected.

Do not treat possession of a widely shared code as sufficient proof when
the contract requires organisation-only access. Combine the code with
identity eligibility.

## Verified Email Domains

Verified-domain restrictions are a useful initial enterprise eligibility
mechanism.

Rules should:

- normalise domains consistently;
- require verified user email where domain eligibility is relied upon;
- support multiple domains per organisation/contract;
- be administratively auditable; and
- avoid treating email domain as permanent employment proof beyond the
  contract's intended risk model.

For higher-assurance contracts, future SSO or explicit staff
provisioning may be preferable.

## Contract Lifecycle

A recommended lifecycle is:

```text
draft -> active -> suspended -> expired
                 -> terminated
```

### Draft

Agreement is configured but grants no learner eligibility.

### Active

Eligible users may materialise access according to coverage and contract
rules.

### Suspended

Temporarily prevents new access while preserving the agreement and
historical records.

### Expired

The effective period ended. New access is blocked unless renewal policy
says otherwise.

### Terminated

Agreement was explicitly ended. Historical access/learning remains
traceable.

Renewal should normally create a new contract period/version or explicit
renewal record rather than silently rewriting historical commercial
terms.

## Coverage Versioning

If contract coverage changes materially over time, the platform must be
able to explain what was covered when an entitlement/enrolment was
issued.

Possible approaches include immutable contract terms per contract period
or versioned coverage records.

Do not make historical entitlement validity depend on the current
mutable course list alone.

## Entitlement Integration

Enterprise contracts should authorise entitlements rather than create
learning state directly.

Each materialised learner entitlement should record enough origin
information to answer:

```text
Why was this learner allowed into this offering?
Which organisation/contract authorised it?
When was it issued?
Which coverage rule applied?
```

The resulting enrolment remains pinned to exact learning
content/version.

## Contract Expiry and Existing Learners

Expiry policy must be explicit.

Potential policies include:

- block only new enrolments while allowing existing enrolments to
  finish;
- expire active learner access at contract end;
- allow a grace period;
- honour enrolment-specific access duration established when access
  was granted.

The correct policy is commercial/product-specific, but the architecture
should express it through entitlement/enrolment access state rather than
deleting learning evidence.

## Revocation and Suspension

Suspending or terminating a contract should prevent new access according
to policy.

Existing learning records remain historical evidence.

If active learner access must also be removed, perform explicit
entitlement/enrolment access transitions with audit evidence rather than
cascading deletion.

## Access Owner Self-Service

At access-grant or contract creation, a platform administrator records one or
more Access Owner email addresses. The system creates scoped pending assignments
rather than granting a global organisation role. Once notifications and the
account invitation flow are supported, each recipient receives a single-use
setup/acceptance email. The assignment becomes active only for the authenticated
account whose verified normalized email matches the invitation. Transfers,
additional owners and revocation retain actor/timestamp audit evidence.

The Access Management dashboard is intentionally narrow. For each assigned
source it may show:

- purchase or contract identity and covered offering;
- the human-readable discount/access code through the audited retrieval
  boundary;
- purchased capacity, redeemed uses and remaining uses for finite grants;
- utilisation without a synthetic remaining-use limit for blanket/100%-covered
  contracts; and
- access-derived learners with name, email, course/offering, bounded progress
  and complete/incomplete state.

The learner list is derived only through entitlements/enrolments whose origin is
the assigned grant or contract. It excludes unrelated enrolments, detailed
SCORM state, survey answers, certificates and broader learner profiles unless a
separate explicit product permission is later accepted.

Each redemption retains the stable learner identity and the verified email used
at redemption. The Access Owner list shows that point-in-time redemption email,
not merely the learner's current account email. A later workplace/email change
does not detach the learner from the originating grant, revoke their exact
enrolment, hide previously completed learning, or move the redemption to a new
organisation. Current email verification still governs new eligibility
decisions.

For a finite grant marked customer-extendable, its Access Owner may choose an
additional-use quantity and enter Stripe Checkout. Product/price, allowed
quantity and grant ownership are resolved server-side. A signed replay-safe
webhook creates the capacity-extension record and atomically increases total
capacity; the success redirect never fulfils it. Blanket/100%-covered contracts,
revoked/expired sources and administratively fixed grants have no purchase
action.

Do not expose internal platform administration or unrelated learner details
merely because someone owns an access allocation.

## Organisation Reporting

Useful organisation-level metrics may include:

- purchased capacity;
- redeemed capacity;
- active learners;
- enrolments by offering;
- completion counts/rates;
- event registrations/attendance where covered;
- contract utilisation over time; and
- upcoming expiry/renewal.

Initially these can be bounded PostgreSQL read models. Add asynchronous
projections only when reporting complexity or performance justifies
them.

## Privacy and Data Minimisation

Organisation customers may legitimately need aggregate or staff-level
training information depending on the contract.

Access must be explicitly defined rather than assumed.

A company buying seats does not automatically mean every company
administrator should see every learner's unrelated learning history or
survey responses.

Particularly sensitive survey response content should remain governed by
the survey/product privacy model and should not be exposed through
organisation reporting merely because completion status is visible.

## Enterprise Events

Contracts may cover instructor-led events as well as courses.

The same coverage/entitlement model should answer whether an employee
may register for a covered event without individual payment.

Event registration, capacity, approval, and attendance remain owned by
the Events domain.

An occurrence may independently use open entry, require unrestricted
registration, or require registration restricted to one or more verified email
domains, whether delivery is in-person or virtual. Contract coverage and
domain eligibility answer different questions: coverage determines who need not
pay, while the Event registration policy determines who may register. Where both
apply, both checks must pass.

A platform administrator may make a learner-specific, audited exception to a
restricted Event's domain policy. That exception belongs to the Event
registration and does not modify the organisation, contract, allowed domains or
the learner's eligibility for any other offering.

## Access-Code Security

Retrievable organisation/enterprise codes should use the cryptographic
hardening described in Commerce and Entitlements: deterministic keyed
lookup plus authenticated encryption for recoverable display, with key
material outside PostgreSQL.

High-value blanket-access codes deserve especially careful audit,
rotation, and revocation support.

## Audit Requirements

Consider durable audit evidence for:

- contract creation/activation/suspension/termination;
- coverage changes;
- eligibility/domain changes;
- access-code creation/retrieval/rotation/revocation;
- manual entitlement grants;
- capacity adjustments;
- privileged organisation-role changes; and
- support overrides affecting enterprise access.

## Notifications

Potential contract/organisation notifications include:

- access code issued/rotated;
- capacity threshold reached;
- contract approaching expiry;
- contract renewed;
- organisation admin invitation; and
- operational notices affecting covered learning.

Use the Notifications capability and transactional domain events rather
than direct provider calls inside contract transactions.

## Concurrency and Integrity

Finite-capacity grants remain serialized at redemption.

Contract activation/coverage changes should use transactional updates so
an entitlement is never issued from partially updated terms.

Where one user can trigger repeated entitlement materialisation, enforce
uniqueness/idempotency so retries do not create duplicate active
entitlements/enrolments for the same intended access.

## Domain Invariants

1.  **Organisation identity is stable across purchases and contracts.**
2.  **A contract authorises access; it does not own learning progress.**
3.  **Every enterprise-derived entitlement is traceable to its
    organisation/contract source.**
4.  **Finite capacity cannot be oversubscribed.**
5.  **Contract expiry/revocation never silently deletes historical
    learning evidence.**
6.  **Coverage at the time of entitlement issuance remains historically
    explainable.**
7.  **Access codes are credentials, not contract identity.**
8.  **Scoped organisation administrators receive only authorised
    organisation data.**
9.  **Eligibility is evaluated from authoritative verified
    identity/rules.**
10. **Enterprise access uses the same entitlement-to-learning boundary
    as individual purchases.**
11. **Access Owner capability is scoped to explicitly assigned grants/contracts
    and activates only after verified invitation acceptance.**
12. **Paid capacity extensions are webhook-fulfilled, idempotent and never
    available for blanket/100%-covered contracts.**

## Recommended Implementation Sequence

### Now

- Preserve existing organisation access-grant and capacity-locking
  model.
- Keep organisation role semantics separate from event/platform roles.
- Ensure grant origin and organisation relationships remain explicit.

### Next --- explicit entitlement foundation

- Introduce source-neutral entitlement semantics.
- Make enrolment access origin directly traceable.
- Treat access grants as entitlement producers/capacity pools.
- Add invitation-backed Access Owner assignments and their bounded dashboard.
- Add capacity-extension orders for eligible finite grants.

### Enterprise contract phase

- Add contract identity/lifecycle.
- Add coverage records.
- Add eligibility rules/domains.
- Add blanket-code resolution.
- Materialise individual entitlements on demand.
- Add contract admin/audit workflows.

### Reporting phase

- Add utilisation read models.
- Add renewal/expiry operational views.
- Add projections only if query cost requires them.

### Later

- Organisation-facing customer portal if product demand warrants it.
- SSO-based enterprise eligibility.
- Automated provisioning/imports.
- More sophisticated contract bundles and event coverage.

## Design Checklist

For a new organisation/enterprise feature, ask:

1.  Is this organisation identity, commercial contract, entitlement, or
    learning behaviour?
2.  What access scope is being granted?
3.  Who is eligible and how is eligibility verified?
4.  Is access finite-capacity or blanket?
5.  What happens at expiry, suspension, renewal, or termination?
6.  Can historical coverage and entitlement origin be reconstructed?
7.  What organisation-level data may customer administrators see?
8.  Is the operation concurrency-sensitive?
9.  What must be audited?
10. Can learning remain unaware of the contract mechanics?

## Related Architecture Documents

Read this alongside Project Overview, Domain Model, Commerce and
Entitlements, Learning Domain, Events Domain, Roles/Authorisation,
Transactional Outbox, and Product Architecture Review.

## Summary

Upskill's current organisation access grants are a strong solution for
fixed-seat course purchases. Enterprise/government agreements require
one additional layer: a first-class contract/coverage model that
authorises source-neutral entitlements.

That model lets a small healthcare provider buy 20 seats and a
government health organisation cover its entire workforce while both
ultimately enter the same learning system. Commercial differences stay
in organisations/contracts/entitlements; learning remains focused on
education and evidence.
