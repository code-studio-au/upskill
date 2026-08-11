# Upskill Domain Model

**Status:** Living architecture document\
**Scope:** Business concepts, bounded contexts, relationships,
lifecycles, invariants, and feature-design guidance\
**Audience:** Product, engineering, administrators, and future
contributors

## Purpose

This document describes what Upskill models independently of framework,
database, or UI implementation. It is a shared mental model, not a
database schema or API specification.

> **Start with the business concept and its invariants; then choose the
> implementation.**

## Product Précis

Upskill is a professional education platform focused primarily on
eating-disorder training for healthcare professionals. The current repository
supports individual self-paced purchases, organisation-aware access grants and
versioned online learning. The target product adds blanket
enterprise/government access and instructor-led physical or virtual training.

Target Events may use open entry, unrestricted required registration or
verified-domain-restricted required registration alongside pre-event
SCORM/surveys/resources, attendance, post-event learning and certificates,
regardless of physical or virtual delivery. The complete domain model therefore
spans current commerce, access rights, immutable learning content, evidence and reliable
asynchronous work, plus target event operations, enterprise entitlements and
scoped staff responsibility.

## Model Horizons

### Current Product

Identity/authorization, Stripe checkout, course-specific access grants,
enrolments, versioned content, learning evidence, certificates, organisations,
audit and the transactional outbox are implemented bounded areas.

### Target Product

Events, resource-scoped event assignments, access-owner assignments, attendance,
explicit source-neutral entitlements, enterprise contracts, notifications and
richer operational reporting are target bounded contexts. Their concepts are
defined here so the current model can evolve without incompatible shortcuts.

### Future Possibilities

Learning programs, additional activity types, subscriptions/promotions, support
impersonation, dedicated projections and scale-driven messaging/search
infrastructure remain trigger-based options.

## Domain Philosophy

- **Education is multi-modal.** SCORM, surveys, resources, attendance,
  and future requirements are reusable learning activities.
- **Commerce is separate from education.** Payments/contracts explain
  why access exists; learning records what happened.
- **Historical learning remains accurate.** Published versions and
  evidence stay reconstructable after later changes.
- **Responsibilities overlap.** A person can be learner,
  administrator, coordinator, and presenter in different contexts.
- **Identity outlives access.** Mutable roles, assignments and email addresses
  control current actions without rewriting stable historical attribution,
  entitlements or learning evidence.
- **Reliability is part of domain design.** Required post-commit work
  is recorded transactionally through the outbox.

## Bounded Contexts

### Identity and Authorisation

Better Auth owns identity/session mechanics. Upskill owns business
capabilities, ownership rules, scoped assignments, versioned authenticated-user
onboarding and operating experiences. Open-entry Event check-in creates or
reuses a stable User in a provisional, unverified and not-onboarded state without
granting an authenticated session.

### Commerce

Owns products, pricing, orders, Stripe reconciliation, refunds, and
commercial snapshots.

### Entitlements and Access

The target abstraction owns the source-neutral right to receive learning.
Current purchases and access grants create enrolments directly; organisation
seats, enterprise agreements, promotions, and manual grants should eventually
produce or authorize explicit entitlements.

### Learning

Owns enrolments, activity composition, progress evidence, completion,
exact-version delivery, and learning history.

### Content

Owns reusable versioned SCORM, surveys, resources, and future activity
implementations. Published content is immutable.

### Events

This target context owns occurrences, sessions, registrations, capacity, staff
assignments, attendance, event workflow, and composition of learning around
scheduled delivery. It is not implemented in the current repository.

### Certificate rendering

Produces a non-persisted document on demand from the authenticated learner's
current verified completion and exact learning version. It owns no certificate
state and does not define completion.

### Organisations and Contracts

Owns organisation identity and future enterprise agreements, eligibility
rules, covered offerings, and organisational access relationships.

### Notifications

Target capability owning reusable Offering/System Email designs and versions,
Section-embedded automation policy, Occurrence Communication Plans, schedules,
delivery channels, preferences, immutable delivery evidence and asynchronous
delivery. Additional channels and sophisticated preference policy remain future
possibilities.

### Reporting and Projections

Owns read-optimised views when transactional queries are insufficient.
Source-of-truth records remain in their owning domains.

### Platform Operations

Owns observability, deployment/runtime health, worker operation,
DLQ/outbox monitoring, and operational support tooling.

## Core Actors

- **User:** authenticated person known to Upskill; may hold multiple
  capabilities.
- **Learner:** user participating in learning with ownership-scoped
  access.
- **Platform Administrator:** broad platform-management capability; dedicated
  sub-capabilities include governed System Email design/version management.
- **Access Owner:** customer contact assigned to specific grants/contracts with
  bounded allocation, utilisation and learner-status visibility.
- **Assigned Event Instance Administrator:** operational ownership held only by
  a standard Platform Administrator; supports shared responsibility/leave cover
  but grants no separate authority.
- **Event Coordinator:** event-occurrence-and-region-scoped operational
  responsibility.
- **Event Presenter:** narrow occurrence/session-scoped delivery and
  attendance responsibility.
- **Global Support Administrator:** future exceptional capability for
  troubleshooting and audited impersonation.

## Core Commercial Concepts

- **Product:** commercial representation of something sold, distinct
  from educational identity.
- **Order:** historical snapshot of purchasing intent, price,
  currency, quantity, and target.
- **Payment:** external settlement state; never learning progress.
- **Organisation:** healthcare company, government entity, or other
  customer grouping.
- **Enterprise Contract:** future agreement describing broad
  organisation coverage and eligibility.
- **Access Grant:** current capacity/rule mechanism supporting
  organisation access codes.
- **Access Owner Assignment:** invited/active/revoked relationship between a
  verified user identity and exact access-grant or contract resources; it is not
  a global organisation or platform role.
- **Access Code:** redeemable credential for a grant; not the grant
  identity or entitlement.
- **Entitlement:** source-neutral right to defined learning.

## Core Learning Concepts

- **Course:** stable identity for a self-paced offering.
- **Course Version:** immutable version of course structure and
  referenced content.
- **Learning Offering:** conceptual parent for something a learner can
  enrol in/progress through; does not require one universal table.
- **Learning Activity:** stable administrative identity for educational
  work/evidence such as SCORM, survey, resource, attendance, or future types.
- **Learning Activity Version:** exact immutable delivery snapshot for one
  revision, encompassing its validated type-specific content, configuration,
  immutable object references and intrinsic completion semantics.
- **Section:** ordered, titled authored journey grouping used consistently by
  both Courses and Events; learner progress considers its Learning Activity
  Items only. Labels such as "Pre-eLearning Survey" or "Pre-Event Survey" are
  titles, not distinct structural types.
- **Learning Activity Item:** Section item referencing one exact Learning
  Activity Version and participating in access/evidence/completion under its
  configured requirement semantics.
- **Automated Email Item:** target administration-only Section item referencing
  an exact Email Design Version and explicit trigger/timing/audience policy; it
  is omitted from learner activity lists and never affects progress/completion.
- **Event Section Release Rule:** immutable phase/anchor/offset policy on an exact
  Event Section, resolved from final administrator confirmation, participation,
  occurrence or Session time; it is independent of optional predecessor
  completion requirements.
- **Enrolment:** learner relationship with exact delivered learning,
  anchoring progress/evidence/completion.
- **Enrolment Region Snapshot:** target point-in-time region captured when Course
  participation begins, enabling historical regional analytics independently of
  the User's later current-region changes.
- **Learning Evidence:** SCORM attempts, survey responses, resource
  completion, attendance, assessments, and overrides.
- **Completion:** deterministic state derived from configured
  requirements and evidence.
- **Certificate:** non-persisted document rendered on demand from current
  verified completion; never the source of completion.

## Core Content Concepts

- **SCORM Activity Content:** type-specific child of a Learning Activity
  Version, including validated launch metadata, content hash and immutable
  extracted-object prefix delivered from an isolated origin.
- **Survey Activity Content:** type-specific child of a Learning Activity
  Version containing immutable published question/instruction structure and
  response rules; responses tie to the exact activity version.
- **Resource Activity Content:** type-specific child of a Learning Activity
  Version containing the exact immutable object reference, integrity and
  display metadata, broad enough to evolve beyond PDFs deliberately.

## Core Communication Concepts

- **Email Design:** stable reusable authored email identity, classified as an
  Offering Email or governed System Email.
- **Email Design Version:** immutable published subject/body and allowlisted
  typed-variable contract revision.
- **System Email Contract:** code-owned stable key defining mandatory trigger,
  audience, variables, preference/security rules and content constraints while
  allowing compatible administrator-authored content versions.
- **Occurrence Communication Plan:** Event Occurrence snapshot of exact
  Automated Email Items/versions and policies inherited from its Event Template.
- **Occurrence Email Override Version:** immutable occurrence-local content or
  permitted timing revision affecting only eligible unsent deliveries.
- **Notification Delivery Snapshot:** privacy-scoped exact rendered message (or
  complete immutable render inputs) tied to its Email Design Version, recipient,
  trigger and provider delivery evidence.

## Core Event Concepts

- **Event / Event Template:** stable reusable identity for an
  instructor-led/blended offering. It is internal authoring identity and does
  not own a public URL slug.
- **Event Template Version:** immutable published future-instance definition,
  including exact Section Items/content versions, workflow/release defaults,
  communication plan, default assigned standard administrators and one or more
  default Coordinators per configured region plus default Presenters for every
  presenter-required occurrence/Session scope.
- **Event Occurrence / Instance:** scheduled delivery pinned to one exact Event
  Template Version, with dates, timezone, delivery mode, capacity, snapshotted
  administrator ownership, other assignments, Sessions, ordered Sections and a
  required unique friendly slug for its public URL.
- **Event Session:** attendance unit such as a workshop day/session.
- **Registration:** person's request/intention to participate,
  distinct from enrolment and attendance.
- **Registration Mode:** occurrence policy selecting open entry with no
  registration, required unrestricted registration, or required registration
  using a verified email domain allowlist; independent of delivery mode and
  approval workflow.
- **Registration Eligibility Decision:** retained evidence that a required
  registration was allowed through unrestricted policy, a verified-domain match,
  or a learner-specific platform-administrator override.
- **Coordination Region:** configurable hierarchical operational area selected
  by an Event Occurrence, such as country, state, LHD, district or a
  customer-defined region.
- **Registration Region Snapshot:** learner-confirmed point-in-time region used
  to route one Registration without making mutable profile geography historical
  truth.
- **Regional Review List:** one occurrence-and-region candidate list owned by
  its assigned Coordinators until manual or deadline lock.
- **Regional Review Round:** retained set of regional lists and deadlines for an
  initial or rescheduled/reopened registration period; later rounds never
  rewrite earlier selection evidence.
- **Registration Priority:** optional occurrence-defined integer on a
  Coordinator-approved candidate; larger values rank higher across regions, but
  the score is advisory to accountable assigned-administrator selection.
- **Late Registration Invitation:** high-entropy, expiring, single-use
  occurrence invitation that bypasses only the public registration cutoff and
  creates an assigned-administrator-owned late candidate after authentication.
- **Guest Event Participant:** occurrence-scoped relationship to a stable User
  retaining submitted point-in-time name/email; it is not a Registration,
  verified identity claim or authenticated session.
- **Provisional / Soft Account:** stable User created from name/email by the
  shared administrator/open-entry provisioning boundary, with unverified email
  and onboarding incomplete; account setup grants no capability until the user
  proves control.
- **Guest Check-In:** timestamped evidence that the guest submitted details,
  received the guarded Join action and/or used it within an attendance window;
  it is distinct from confirmed Attendance unless occurrence policy says
  otherwise.
- **Event Prerequisite Recovery Window:** occurrence/session-scoped period in
  which an exact prerequisite deep link offers normal authentication, OTP-backed
  event-task access or explicitly enabled facilitated Survey completion.
- **Facilitated Survey Capability:** short-lived one-use authorization bound to
  one User, accepted Registration, occurrence item and exact Survey Version; it
  is not an authenticated account session.
- **Event Survey QR Access:** persisted Event Occurrence-owned access record for
  one exact Survey item and optional Session, with opaque public reference,
  availability policy and rotation/revocation lifecycle; email/PII is captured
  after scanning and is never encoded in the QR.
- **Coordinator Assignment:** occurrence-and-region-scoped operational
  responsibility shared by one or more Coordinators.
- **Event Instance Administrator Assignment:** operational ownership record
  pointing to a User who must hold the standard Platform Administrator role;
  drives responsibility/notifications but grants no authority itself.
- **Presenter Assignment:** narrow occurrence/session delivery responsibility;
  one or more active assignments cover every presenter-required scope.
- **Attendance:** durable participation evidence with actor/timestamp
  and correction semantics.

## Core Identity Experience Concepts

- **Onboarding Definition Version:** immutable required/optional demographic,
  professional-context and baseline-knowledge policy shown before the learner
  dashboard; it references one exact published Survey Version and snapshots
  privacy, profile-mapping and activation policy.
- **Onboarding Assignment:** one User's required, exact Onboarding Definition
  Version; new publication never silently retargets it.
- **Onboarding Response:** privacy-scoped answers for one assignment and exact
  Survey Version. Minimal completion remains separately durable; neither is
  Learning Evidence.

## Core Reliability Concepts

- **Audit Event:** durable business/security evidence; PostgreSQL
  remains system of record.
- **Outbox Event:** work/fact committed with domain state so
  asynchronous intent cannot be lost.
- **Work Command:** request for one asynchronous action.
- **Domain Event:** fact that already happened and may have multiple
  consumers.
- **Worker:** idempotent background consumer of versioned queue
  messages.
- **Dead-Letter Queue:** operational destination for repeatedly
  failing work requiring remediation.

## Key Relationships

```text
Organisation -> purchases / contracts / grants -> entitlement eligibility

User -> Entitlement -> Enrolment -> exact Learning Offering
     -> exact Learning Activity Versions -> Evidence -> Completion -> Certificate
```

```text
Event Template -> immutable Event Template Version -> Event Occurrence
      -> Sessions
      -> Coordination Regions
      -> standard-admin owners / regional Coordinator / Presenter Assignments
      -> Registrations -> regional review lists -> final selection
      -> Participant access
      -> Pre-event Activities
      -> Attendance
      -> Post-event Activities
      -> Completion
      -> Occurrence Communication Plan -> scheduled/delivered Emails
```

```text
Domain transaction -> state + audit + outbox -> COMMIT
                   -> dispatcher -> queue -> idempotent worker
```

## Major Lifecycles

### Course

`draft version -> published immutable version -> archived course`

### Access Grant

`created -> redeemable -> exhausted / expired / revoked`; revocation
blocks future use without deleting history.

### Event Occurrence

`draft -> published -> registration open -> registration closed -> in progress -> completed -> archived`.

### Registration

`submitted -> coordinator_approved|not_approved -> regional_list_locked ->
event_administrator_selected|waitlisted|not_selected -> confirmed/locked_in`,
with later Platform Administrator correction or
withdrawal/cancellation where policy permits. Coordinator approval is
provisional candidacy only. Coordinator authority ends when their list is
manually or automatically locked, and final confirmation remains beyond their
authority. Transitions are retained, not represented by deletion.

The learner confirms the relevant current Coordination Region at registration;
the Registration snapshots it. Profile moves affect future registrations only.
Each occurrence has a public registration cutoff and a separate later
Coordinator lock cutoff. At the latter, all open regional lists become
server-effectively locked with their existing decisions and optional rankings.
Only approved candidates advance, including approved but unranked candidates.

The assigned Event Instance Administrators compare ranked candidates by descending
priority across regions, then applies documented best-fit judgement to ties,
unranked candidates and remaining capacity. Final selection is human and
capacity-safe. A user-specific late invitation may bypass only the public cutoff;
its resulting Registration enters a separate assigned-administrator-owned queue and
does not rewrite locked regional lists.

Before submission, and again before delayed acceptance, the server evaluates the
occurrence's registration mode. Unrestricted required registration has no domain
allowlist; restricted required registration requires an exact match against the
learner's verified email domain. Existing accepted registrations are not
silently rewritten when the allowlist changes.

An authorised platform administrator may add one learner who does not match a
restricted occurrence's allowlist. The registration retains
`administrator_override` eligibility evidence with actor/timestamp provenance.
The override changes neither the learner identity nor occurrence policy and
bypasses no capacity or lifecycle constraint.

### Attendance

`not recorded -> attended | absent`, with corrections retaining
provenance.

### Outbox Work

`committed -> available -> claimed -> dispatched -> processed`, with
retry/redelivery and DLQ for repeated failure.

## Cross-Domain Invariants

1.  **Published educational content is immutable.**
2.  **Every enrolment has a traceable access origin.**
3.  **Commerce does not own or erase learning evidence.**
4.  **Learning does not interpret Stripe/payment mechanics.**
5.  **Completion derives from evidence and explicit rules.**
6.  **Certificates render only from current verified completion.**
7.  **Registration, participation, attendance, and learning progress
    remain distinct.**
8.  **Event delivery mode, registration mode, approval workflow and
    commercial access remain independent policy dimensions.**
9.  **Domain-restricted registration is enforced from authoritative verified
    identity, not client state.**
10. **Mutable email, roles and assignments do not rewrite stable historical
    attribution, established entitlements or learning evidence.**
11. **Administrator restriction overrides are learner-specific, auditable and
    limited to the domain criterion.**
12. **Resource-scoped assignments never become implicit global
    permissions.**
13. **Sensitive server boundaries re-authorise from authoritative
    data.**
14. **Required asynchronous intent commits atomically with domain
    state.**
15. **Queue delivery is at least once; consumers are idempotent.**
16. **Audit evidence is distinct from operational logging.**
17. **Historical records survive revocation/archival unless an explicit
    retention policy requires otherwise.**
18. **New activity types integrate into the common evidence/progress
    model.**
19. **New commercial models produce entitlements rather than leaking
    special cases into learning.**
20. **Access Owners see and extend only explicitly assigned commercial
    sources; they never gain unrelated learner or organisation access.**
21. **Open-entry check-in may create a provisional not-onboarded User but never
    grants a session, verified-email state or ordinary dashboard access.**
22. **Guest link access and early disclosure are not Attendance; only explicit
    in-window check-in policy or staff confirmation establishes Attendance.**
23. **Admin-added and open-entry users share one idempotent soft-account and
    setup-email lifecycle; domain records attach to the resulting stable User.**
24. **After verification and onboarding, already-linked established Attendance
    appears without manual participant matching.**
25. **A restricted-Event administrator override may provision that same soft
    account but bypasses only the exact occurrence's domain criterion.**
26. **Prerequisite recovery resolves the exact participant and activity before
    accepting evidence; later email matching is not a workflow.**
27. **Email-only facilitated access is last-resort, Survey-only and
    single-capability scoped; SCORM requires authenticated or OTP-verified
    event-task access.**
28. **Each Event Survey QR resolves one occurrence, optional Session, item and
    Survey Version through an opaque reference; it never embeds email or raw
    identifiers.**
29. **Assigned standard-administrator confirmation is the final registered-Event acceptance
    boundary; Coordinator approval is provisional and does not reserve
    capacity.**
30. **Event Section availability is server-derived from exact release rules;
    notification delivery never controls access.**
31. **Open-entry activation releases Pre-Event and the current Session without
    moving future Post-Event or Follow-up schedules.**
32. **Mutable user region never rewrites a Registration Region Snapshot; any
    active-registration reassignment is explicit, authorized and retained.**
33. **Regional lists become immutable at manual/deadline lock; unreviewed
    registrations never become approved and missing rankings remain null.**
34. **Late invitations are user-specific and bypass only the public cutoff; they
    do not reopen regional lists or bypass eligibility, capacity or final
    selection.**
35. **Retiring a region never implicitly cancels a Registration; explicit
    participant cancellation retains prior evidence and emits an automatic,
    retryable notification fact.**
36. **Automated Email Items are visible in administration Sections but are not
    Learning Activities and never influence learner progress or completion.**
37. **Published Email Design Versions, occurrence override revisions and sent
    delivery snapshots are immutable and exact-version attributable.**
38. **System administrators may revise System Email content only within its
    fixed code-owned trigger, audience, variable and security contract.**
39. **An Event Occurrence is pinned to one immutable Event Template Version;
    later versions affect only future instances unless explicitly migrated.**
40. **Default Event Instance administrators are versioned template content and
    snapshot into new instances only after current standard-admin validation.**
41. **Event Instance administrator ownership supports one or more Users but
    grants nothing without the active standard Platform Administrator role.**
42. **Administrator-role revocation is immediate, ends usable owner assignments
    without erasing history and produces successor Template defaults without
    mutating old versions or breaking existing Event operation.**
43. **Every active Event Instance region has one or more active Coordinators;
    revocation retains their history and uses replacement or standard-admin
    fallback rather than stranding the regional list.**
44. **Disabled default Coordinators are removed through a successor Event
    Template Version; historical versions and existing instance provenance remain
    immutable.**
45. **Every presenter-required occurrence/Session has one or more active
    Presenters; revocation retains attribution and triggers replacement or
    administrator attention without inventing delivery evidence.**
46. **Disabled default Presenters are removed through a successor Event Template
    Version while earlier versions and past presentation/Attendance attribution
    remain unchanged.**
47. **Visual analytics explicitly distinguishes current User region from
    participation-time Event Registration/Course Enrolment Region Snapshots.**
48. **Section analytics/export status is derived from contained required
    Learning Activity evidence; it is not an independent mutable flag and
    excludes Automated Email Items.**
49. **Onboarding reuses an exact immutable Survey Version but is not a Learning
    Activity and never creates Learning Evidence or educational progress.**
50. **Publishing new onboarding questions does not silently invalidate or
    retarget existing completion/assignments; re-onboarding is explicit and
    audited.**
51. **`userOnboarded` is false for provisional/unverified Users and is derived
    from verified identity plus completion of the User's applicable exact
    Onboarding Assignment.**
52. **Survey option answers reference immutable option IDs; bulk authoring and
    display labels never replace server-side exact-version validation or
    canonical domain mapping.**
53. **A required Checkbox/acknowledgement is satisfied only by an explicit true
    value and material acceptance retains exact versioned wording/content.**

## Versioning Philosophy

Version data when later mutation would make historical evidence
ambiguous. This includes published course structures, SCORM package
versions, survey versions, resource versions, and potentially published
event-learning configurations.

Stable identities support management/cataloguing; immutable versions
preserve historical truth. Do not version everything merely for
architectural purity.

## Evidence Philosophy

Prefer durable underlying evidence over mutable summary state. SCORM
attempts, survey responses, resource completion, attendance, and
overrides explain what actually happened. Percentages and dashboard
summaries are projections over that evidence.

## Authorisation Philosophy

Use global capabilities for broad platform responsibility, ownership for
personal learner resources, resource-scoped assignments for
standard-admin Event ownership plus Coordinator/Presenter duties, and operating modes for focused UX. A
person may hold multiple capabilities; never encode every combination as
a new role.

## Important Domain Boundaries

### Event / Learning

Events own schedule, registration, capacity, Sessions, assignments, attendance,
and Event Section availability. Learning owns reusable activity behaviour,
evidence, and common progress/completion. Events compose activities in the same
Section structure as Courses rather than clone them.

### Commerce / Learning

Commerce/contracts create or authorise entitlements. Entitlements lead
to exact learning enrolments. Learning remains unaware whether access
came from payment, organisation seats, blanket government coverage, or
future sources.

### Audit / Observability

Audit answers who changed important business/security state and when.
Logs/metrics answer whether the system is healthy and why technical
failures occurred. External observability is not the audit system of
record.

### Reporting

Transactional records remain authoritative. Start with bounded read
queries; add read-optimised projections from domain events only when
reporting complexity/load justifies them.

## Adding a New Feature

Before implementation:

1.  **Which bounded context owns it?** Choose one domain with authority
    for the business rule.
2.  **Which concept does it change?** Activity type, event workflow,
    entitlement source, permission, evidence, notification, or genuinely
    new concept?
3.  **Which invariants apply?** Write these before choosing
    tables/routes/components.
4.  **Does historical reconstruction matter?** Define versioning if
    later edits could make old evidence ambiguous.
5.  **What is the authorisation model?** Global, ownership-based, or
    resource-scoped? What fields are genuinely required?
6.  **What evidence does it create?** If it affects completion, identify
    authoritative evidence rather than adding arbitrary progress state.
7.  **Does it require asynchronous work?** Commit required outbox work
    inside the same transaction.
8.  **What must be audited?** Identify
    privileged/destructive/commercially significant transitions.
9.  **What concurrency/failure cases exist?** Consider duplicates,
    capacity races, redelivery, retries, and process crashes.
10. **Does it duplicate an existing subsystem?** Reuse Surveys,
    Entitlements, Learning Activities, Outbox, etc. rather than building
    parallel systems.

## Feature Design Template

For significant features, record:

```text
Business problem
Owning bounded context
Affected concepts
Current state
Proposed state/lifecycle
Authorisation
Invariants
Versioning/history
Evidence/progress impact
Transactional boundaries
Async/outbox work
Audit requirements
Privacy/data minimisation
Failure/concurrency cases
Testing strategy
Migration/backwards compatibility
Operational metrics
```

Use proportionate design depth; this should guide important changes, not
become bureaucracy for trivial ones.

## Architecture Principles to Preserve

- Prefer evolution over rewrites.
- Prefer explicit transactions over distributed complexity.
- Keep PostgreSQL as the authoritative relational domain store.
- Keep the modular monolith while it remains the simplest correct
  architecture.
- Isolate risky execution environments such as SCORM.
- Version historical educational content deliberately.
- Keep commercial access separate from educational evidence.
- Make server-side authorisation explicit.
- Use async infrastructure when it solves a real reliability/latency
  problem.
- Design for at-least-once delivery, not fictional exactly-once
  guarantees.
- Add infrastructure in response to demonstrated requirements, not
  fashion.

## Documentation Map

The [architecture handbook index](README.md) links every current companion
document, including Commerce and Entitlements, Learning, Events, Roles and
Authorisation, Organisations and Enterprise Contracts, Notifications,
Reporting/Observability, Transactional Outbox, Security, Product Roadmap and
Future Architecture Ideas. Accepted decision history remains in the
[ADR collection](../adr/README.md).

## Summary

Upskill is best understood as a professional-education platform whose
core domains cooperate through explicit boundaries: commerce grants
rights, entitlements bridge access, learning records evidence, events
organise scheduled delivery, authorisation scopes responsibility, and
the outbox makes committed follow-up work reliable.

The domain model is deliberately evolutionary. It names stable concepts
and invariants without forcing premature generic tables, microservices,
workflow engines, or messaging platforms.

When adding features, the first question should be **what business
concept and invariant does this change?** Only then should
implementation structure be chosen.
