# Commerce and Entitlements

**Status:** Living architecture document\
**Scope:** Upskill commerce, access rights, access grants, orders,
payments, and enrolment hand-off\
**Audience:** Product, engineering, platform administrators, and future
contributors

## Purpose

This document defines the boundary between commerce, entitlements, and
learning in Upskill. It records the current implementation, the business
models the platform must support, the invariants that should remain true
as the product grows, and the recommended direction for future
development.

The central architectural rule is:

> **Commerce determines why access may be granted. Entitlements
> represent the right to access learning. Learning consumes that right
> without needing to understand how it was obtained.**

## Product context

Upskill is a professional education platform focused primarily on
eating-disorder training for healthcare professionals. It supports
several commercial access models that ultimately lead to the same
educational experience.

### Individual purchases

An individual healthcare professional can purchase a self-paced course
directly. Stripe handles payment processing, while Upskill remains
authoritative for the resulting order, access, enrolment, learning
history, completion, and derived certificate eligibility.

### Organisation seat purchases

Healthcare organisations may purchase fixed numbers of course places,
commonly 10, 20, or 100 seats. Upskill provides an access code
associated with the purchased course and capacity. Eligible staff redeem
the code until the purchased capacity is exhausted.

The target purchase flow also records one or more customer-side Access Owner
email addresses. Their accepted scoped assignments expose only the associated
grant, access code, allocation utilisation and status of learners whose access
originated from it.

### Government and enterprise contracts

Large customers may purchase broad contractual access rather than
individual seats. A government health organisation may, for example,
purchase annual blanket access for its workforce and receive a shared
organisation code that allows eligible staff to access covered courses
without individual payment.

The current access-grant implementation is course-version oriented.
Blanket multi-course contractual access should therefore become an
explicit product/domain capability rather than a collection of
course-specific exceptions.

## Domain philosophy

### Commerce grants rights; learning records outcomes

Commerce owns questions such as what was purchased, by whom, at what
price, in what quantity, whether payment succeeded, and what contractual
access exists.

Learning owns enrolments, exact educational versions, progress,
evidence, completion, and certificates.

These concerns should remain separate even when they participate in one
end-to-end workflow.

### Entitlement is the hand-off boundary

An **entitlement** is the business right permitting a learner to access
defined learning. It is deliberately neutral about its source.

```text
Individual purchase ---------+
Organisation seat grant -----+
Enterprise contract ---------+--> Entitlement --> Enrolment --> Learning
Promotion / scholarship -----+
Manual support grant --------+
Future subscription ---------+
```

Adding a commercial model should primarily mean adding another producer
of entitlements, not modifying SCORM, surveys, resources, progress,
certificates, and learner routes.

## Current Product

Upskill already contains most of the required pieces, although the
current implementation uses `access_grant` and direct enrolment creation
rather than one explicit entitlement abstraction.

### Orders and Stripe checkout

The checkout flow snapshots the exact published course version, price,
currency, quantity, and enrolment duration before redirecting to Stripe.
The browser success redirect is not trusted to fulfil the order; a
signature-verified webhook is authoritative.

Fulfilment locks the order, validates the Upskill session metadata,
purchaser, session identity, amount, currency, and course-version item,
then changes order state and creates access/enrolment state within a
database transaction. Durable audit evidence and outbox work are
committed with the domain change.

This design should be preserved. Stripe events are replayable external
messages, and the order row is the serialization boundary that makes
fulfilment idempotent.

### Access grants and access codes

Administrator-managed grants currently support an exact published course
version, organisation, human-readable code, total capacity, redeemed
capacity, enrolment duration, optional expiry, optional
verified-email-domain restrictions, and revocation.

Redemption locks the grant row before checking capacity and incrementing
usage. This prevents concurrent redemptions from oversubscribing
purchased capacity and is an important invariant to retain.

An access code is a credential used to discover/redeem a grant. It is
**not** itself the entitlement or domain identity. Code rotation,
storage, delivery, or retrieval should not change the identity of the
underlying commercial right.

### Enrolments

Current purchase and redemption flows create exact-version enrolments
directly. Enrolments retain learning history independently of later
publication changes. This is a strong learning-domain property.

The recommended evolution is not to replace enrolments, but to make the
access right that caused each enrolment explicit and consistent across
commercial sources.

## Target Product

Distinguish three concepts:

1.  **Commercial source** --- order, organisation purchase, contract,
    promotion, manual grant, etc.
2.  **Entitlement** --- the right held by a learner or eligible
    population to access defined learning.
3.  **Enrolment** --- the learner's educational relationship with an
    exact learning offering/version.

This can be introduced incrementally. It does not require an immediate
rewrite of working checkout or access-code flows.

### Entitlement scope

An entitlement should eventually be able to cover one exact course
version, a course resolved to an exact version at enrolment, a set of
courses, all courses under an enterprise agreement, an event/blended
offering, or a future program/bundle.

Once an enrolment exists, it remains pinned to the educational version
actually received. Later contract or publication changes must not
rewrite that history.

### Entitlement holder

Depending on the source, an entitlement may initially belong to an
individual, an organisation, an eligible organisation population, or a
capacity pool from which individual access is materialised.

This is especially useful for blanket contracts: the platform should not
need thousands of pre-created learner records merely to express that
eligible staff may enrol.

## Core concepts and ownership

- **Product:** commercial representation of something sold. Product
  identity must remain separate from educational identity.
- **Order:** immutable commercial snapshot of purchasing intent and
  agreed terms.
- **Payment:** external settlement state. Payment never directly
  represents learning progress.
- **Access grant:** current capacity/rule mechanism for issuing
  access, especially organisation codes.
- **Access code:** redeemable credential for a grant; not the grant's
  identity.
- **Entitlement:** source-neutral right to defined learning scope.
- **Enrolment:** educational record connecting a learner to exact
  delivered learning and anchoring progress/completion.

An entitlement should have an explicit origin such as
`individual_purchase`, `organisation_seat`, `enterprise_contract`,
`promotion`, or `manual_admin_grant`, rather than requiring origin to be
inferred from unrelated nullable fields.

## Architectural invariants

1.  **Learning never trusts payment directly.** SCORM, surveys,
    resources, progress, and certificates do not query Stripe to
    determine educational state.
2.  **Every enrolment has a traceable access origin.** It must be
    possible to explain why a learner received access.
3.  **Commercial changes do not rewrite learning history.** Refund,
    expiry, revocation, or organisation changes may alter access but do
    not silently erase evidence.
4.  **Published educational versions remain immutable.** An enrolment
    stays on the version actually received.
5.  **Capacity cannot be oversubscribed.** Seat-limited redemption
    remains transactionally serialized.
6.  **External payment events are replayable.** Fulfilment remains
    idempotent and safe under duplicate webhook delivery.
7.  **Commercially significant access changes are auditable.** Actor,
    subject, scope, timestamp, and relevant reason are retained.
8.  **Revocation is not deletion.** Previous enrolments and audit
    evidence survive revocation.
9.  **Codes are credentials, not domain identity.** Storage or delivery
    changes must not alter the underlying grant/entitlement.

## Typical workflows

### Individual purchase

```text
Learner chooses course
  -> pending order + immutable order-item snapshot
  -> Stripe Checkout
  -> signed webhook
  -> locked/idempotent order reconciliation
  -> entitlement/access right
  -> exact-version enrolment
  -> audit + outbox commit
  -> learning
```

### Organisation seat purchase

```text
Organisation purchases N seats
  -> capacity-backed access grant
  -> code supplied to organisation
  -> employee redeems code
  -> grant locked
  -> eligibility / expiry / capacity checked
  -> individual access right materialised
  -> exact-version enrolment
  -> capacity + audit + outbox committed atomically
```

### Blanket enterprise contract

```text
Enterprise agreement
  -> organisation entitlement
  -> covered learning scope
  -> shared code / future SSO / eligibility check
  -> individual access right materialised
  -> exact version resolved
  -> enrolment
```

A blanket contract should not copy commerce-specific conditions into
every learning subsystem.

### Administrative support grant

Support, remediation, goodwill, or testing access should use the same
entitlement/enrolment boundary rather than creating unexplained
enrolments. Privileged grants should be audited.

## Access-code security

Upskill requires retrievable human-readable codes for customer support.
One-way password-style hashing cannot satisfy exact recovery.

The current implementation follows
[ADR 0019](../adr/0019-encrypted-recoverable-access-codes.md):

```text
submitted code -> extract public lookup ID -> indexed grant lookup
selected ciphertext -> authenticated decryption -> full normalized-code comparison
```

The server-generated ten-character lookup ID is a stable, non-secret segment of
the displayed human-readable code and is stored uniquely in PostgreSQL. The
complete code is stored only in one AES-256-GCM envelope bound to its grant and
lookup IDs. Deployed key material remains outside PostgreSQL in a dedicated AWS
Secrets Manager value protected at rest by KMS. This preserves efficient
ordinary lookup and authorised repeated recovery without a separate HMAC lookup
key while reducing the impact of a database-only disclosure.

## Expiry, removal, revocation, and refunds

These concepts should remain distinct.

- **Expiry** is a time-based end to access.
- **Removal** is an explicit administrative action affecting current
  learner access.
- **Revocation** prevents future use of a grant/entitlement source
  without deleting historical evidence.
- **Refund** is a commerce event whose educational consequence must be
  an explicit policy decision.

Refund policy should be implemented through entitlement/access state,
not by mutating historical progress.

## Enterprise contracts

Blanket-access customers should eventually have a first-class
contract/agreement model capable of representing organisation,
effective/renewal dates, covered offerings, unlimited versus capped
usage, eligibility rules, permitted domains, commercial reference,
status, administrative ownership, and audit history.

The contract produces or authorises entitlements. It does not become a
second learning system.

This allows one customer to have unlimited annual access to all courses
while another buys 20 seats in one course, without contaminating the
learning domain with separate rules for each customer type.

## Customer capacity extensions

A finite access grant may be explicitly marked customer-extendable and assigned
to one or more Access Owners. An owner can request additional uses from the
assigned dashboard, but cannot directly edit the grant quantity.

The server resolves the authoritative grant, assignment, lifecycle, eligible
price and requested quantity before creating a pending capacity-extension order
and Stripe Checkout Session. The signed webhook locks and idempotently fulfils
that order, then increments grant capacity without replacing its human-readable
code. Existing redemption counts and enrolments are unchanged. Browser return
routes only display the resulting state.

Blanket or 100%-covered contracts have no finite uses to purchase. Expired,
revoked, administratively fixed or otherwise ineligible grants also suppress and
reject the extension action server-side. A later refund policy must explicitly
define the capacity consequence and must never reduce total capacity below uses
already redeemed.

## Events and blended learning

Commerce and entitlements must cover instructor-led and blended events
as well as self-paced courses.

A paid event registration may grant entitlement to an event offering.
The event may contain pre-event SCORM, surveys, resources, attendance
requirements, and post-event activities without commerce needing to
understand those components.

Enterprise agreements may similarly cover both courses and eligible
events. The event domain consumes access rights but owns registration,
scheduling, sessions, attendance, coordinators, presenters, and event
workflow.

An Event's registration mode is separate from its commercial access. Any
physical, virtual or hybrid occurrence may use open entry with no registration,
require unrestricted registration, or require registration restricted to
configured verified email domains. A paid or contract-covered Event can still
use any mode, and satisfying a domain restriction does not by itself prove
payment or entitlement.

Likewise, an administrator override of an Event's domain restriction does not
silently create or waive a separate commercial entitlement. If the same admin
action also grants complimentary/manual access, that access source must be
recorded explicitly alongside the registration.

## Transactional outbox boundary

Where granting access must trigger asynchronous work, the existing
transactional outbox pattern should remain the reliability boundary.

The domain transaction commits its state change, audit evidence, and
outbox event together. A dispatcher later publishes work. If the server
fails after commit but before publication, the outbox row remains. If
publication succeeds but acknowledgement fails, duplicate delivery is
possible and consumers must therefore remain idempotent.

This pattern is appropriate for enrolment notifications, contract
provisioning, emails, analytics projections and future
integration events.

## Future Possibilities

Potential future entitlement producers include subscriptions,
promotional campaigns, scholarships/complimentary access, course
bundles, employer sponsorship, event packages, and partner integrations.

The test for the architecture is simple: **can a new access model be
added mainly by producing a standard entitlement, while learning remains
unaware of the commercial source?** If yes, the boundary is working.

## Implementation roadmap

### Now --- preserve and clarify

- Preserve locked/idempotent Stripe fulfilment.
- Preserve serialized capacity redemption.
- Preserve exact-version enrolments and immutable learning history.
- Document access origin consistently for every enrolment.
- Preserve encrypted access-code storage, indexed candidate lookup and audited
  individual recovery.

### Next --- introduce explicit entitlement semantics

- Define an entitlement domain type and lifecycle.
- Make enrolment origin explicit rather than inferred.
- Treat `access_grant` as a grant/pool capable of issuing
  entitlements.
- Add scoped Access Owner invitations/read models and trace owner-visible
  learners through entitlement origin.
- Add webhook-fulfilled capacity-extension orders for eligible finite grants.
- Add enterprise-contract scope without adding learning-specific
  exceptions.
- Define explicit refund/revocation/access-removal policies.

### Later --- broaden commercial models

- Add multi-course enterprise coverage.
- Support event/blended-learning entitlements.
- Add subscriptions/bundles/promotions only as justified by product
  requirements.
- Introduce reporting projections for commercial utilisation without
  overloading transactional queries.

## Design guidance for contributors

When adding a commerce or access feature, ask:

1.  What commercial source creates the right?
2.  What exactly is the entitlement scope?
3.  Who or what holds the entitlement before enrolment?
4.  When is an exact educational version resolved?
5.  What happens on expiry, refund, revocation, or removal?
6.  What must remain historically immutable?
7.  Is the operation capacity-sensitive or concurrency-sensitive?
8.  What must be audited?
9.  Does asynchronous work require the transactional outbox?
10. Can the learning domain remain unaware of the commercial source?

If the final answer to question 10 is no, reconsider the boundary before
implementing the feature.

## Related architecture documents

This document should be read alongside the project overview, domain
model, roles and authorisation model, learning domain, events domain,
transactional outbox architecture, and product architecture review.

Changes to commerce or access behaviour should update the relevant
architecture document and, where a significant architectural decision is
made, add or update an ADR.

## Summary

Upskill's current commerce implementation already has strong
transactional foundations: immutable order snapshots, signature-verified
Stripe reconciliation, serialized access-code redemption, exact-version
enrolments, durable audit evidence, and transactional outbox work.

The next architectural step is evolutionary rather than disruptive. Make
**entitlement** the explicit neutral boundary between the many reasons a
person may receive access and the single learning system that records
what they actually do.
