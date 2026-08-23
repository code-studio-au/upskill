# Security Architecture and Threat Boundaries

**Status:** Living security architecture document\
**Scope:** Authentication, authorisation, SCORM, commerce, codes,
uploads, storage, async work, audit, secrets, infrastructure, and
hardening

## Purpose

This document describes Upskill's major security boundaries, current
strengths, important threats, and hardening direction. It is an
architecture guide, not a substitute for penetration testing,
privacy/legal review, incident response, or cloud security operations.

> **Treat every trust boundary explicitly: browser to server, user to
> resource, app to third-party content, app to payment provider,
> database to credentials, web to workers, and administrator to
> privileged actions.**

## Security Goals

Protect accounts/sessions, learner personal information, learning
records/certificates, survey data, organisation data, access
codes/entitlements, payment fulfilment integrity, private resources,
uploaded SCORM, privileged capabilities, audit evidence, and production
infrastructure/secrets. Integrity matters as much as confidentiality:
silently changing professional-learning history can be as damaging as
disclosure.

## Security Horizons

### Current Product

Better Auth sessions, server-side ownership/administrator checks, Stripe webhook
verification, isolated SCORM delivery, validated uploads, private object storage,
strict application CSP, structured logging, durable audit evidence and
idempotent queue consumers are implemented. Recoverable access codes are stored
as authenticated ciphertext with an external per-environment key, indexed by a
non-secret lookup segment and protected by authorization, audit, eligibility,
capacity, expiry and revocation controls. Event Survey QR records use random
opaque public references; the QR endpoint discloses only a same-origin guarded
landing URL, and the landing route rechecks authentication, selected/open-entry
participation, occurrence lifecycle and Section release before exact-Survey
access.

### Target Product

The current product includes shared PostgreSQL-backed auth rate limiting,
verified immutable deployment and baseline production metrics/alerts. The
accepted target adds richer edge and domain observability,
grant/contract-scoped Access Owner authorization, Events-scoped authorization
and the security boundaries required by enterprise contracts and notifications.

### Future Possibilities

SSO-backed enterprise eligibility, highly privileged support impersonation,
additional content formats, managed event fan-out and scale-driven
infrastructure remain trigger-based. Each requires a fresh threat-boundary
review before implementation.

## Trust Boundaries

Major boundaries include public browser to primary app, one learner to
another learner's data, scoped event staff to unrelated resources,
primary app to SCORM origin, app to Stripe/PostgreSQL/S3, dispatcher to
SQS, worker to queue payload, future notification providers,
administrators to privileged actions, and CI/SSM to production hosts.

## Identity, Sessions, and Auth Abuse

Better Auth owns authentication/session mechanics; Upskill owns business
authorisation. Use secure HTTP-only cookies and production-appropriate
SameSite/Secure settings. Never base business authorisation only on
client role state.

Process-local rate limiting is not sufficient as the final
multi-instance control. Layer edge/WAF limits, application/auth-provider
controls, shared/account-aware limits where needed, and monitoring. Tune
IP thresholds for healthcare networks where many legitimate users may
share one address.

Password, email OTP and verified-mobile SMS OTP are supported authentication
paths. OTP values are short lived, one use, stored as digests, attempt/resend
bounded and excluded from URLs, logs, audit metadata and queue payloads. Mobile
numbers are normalized to E.164 and are not authentication factors until
explicitly verified. Signed post-authentication state permits only known internal
destinations such as one exact Event prerequisite and cannot become an open
redirect.

Shared-device Event recovery uses an OTP-verified, short-lived task session with
minimal scope instead of exposing the learner's entire account. Completion or
inactivity invalidates it and clears participant-specific browser state. The
last-resort registered-email Survey capability is not authentication: it is
time-bounded, single-use, exact-participant/activity scoped, rate limited and
disabled for sensitive Surveys. Different-email cases require an audited staff
selection rather than fuzzy matching.

Occurrence Survey QR codes carry only opaque high-entropy public references.
They do not embed raw occurrence/session/user IDs, email addresses, OTPs or
capabilities. The server resolves the stored occurrence-owned QR record and
rechecks active window, exact Survey item, registration and Presenter/Coordinator
scope. A photographed code can still be shared, so expiry, rotation/revocation,
rate limiting and downstream participant resolution remain mandatory.

## Authorisation and Data Minimisation

Use global capabilities, learner ownership, grant/contract-scoped Access Owner
assignments, standard-admin Event Instance responsibility records,
occurrence-and-region Coordinator assignments, occurrence/session Presenter
assignments, and domain lifecycle constraints. Navigation visibility is not
security. Server functions resolve authoritative state.

Authorisation applies to fields as well as rows: presenters get
attendance-required fields; coordinators get event-relevant participant
data; regional Coordinators cannot read other regions merely because they share
an occurrence, and none automatically receives full learner history.

Late-registration invitation credentials are high entropy, expiring, single use
and bound to an occurrence plus intended identity. They are not authenticated
sessions and bypass only the ordinary registration cutoff after successful
account setup/login. They must not appear in logs, referrers or generic reports.

An Access Owner read must start from an active assignment and traverse the exact
grant/contract origin to its entitlements/enrolments. It may expose bounded name,
email, offering, progress and completion state, but not unrelated enrolments,
survey answers or detailed evidence. Pending invitations are not permissions;
activation requires the authenticated account's verified normalized email and a
single-use expiring invitation credential. Invitation, activation, revocation,
code retrieval and capacity-extension fulfilment are audited.

## Global Administration and Impersonation

Broad admin power remains explicit and auditable. Future global
support/impersonation is exceptionally privileged and separate from
ordinary role switching. Retain original administrator identity,
impersonated identity, start/end time, clear persistent UI, durable
audit evidence, and consider re-authentication/restrictions for
credential, financial, or destructive actions. Prefer dedicated support
inspection views first.

## Email Designer and Delivery History

System Email management is a dedicated global capability, not implied by Event
Instance ownership or ordinary offering-author access. Code owns each System Email's
trigger, recipient resolver, required-variable schema, mandatory/security fields
and preference classification. Administrative drafts cannot publish unless they
remain contract compatible, and the previous valid active version remains
available for rollback.

Treat administrator-authored email as untrusted content. The current designer
accepts plain text and generates escaped HTML with only code-owned paragraph and
line-break markup. It rejects unknown or missing required variables, executable
template expressions and unrestricted object traversal. Variables are typed
allowlisted values, and generated application links use server-owned route
builders. Preview never sends and uses labelled fixture values. Any future rich
content editor must introduce and verify a strict HTML/CSS/URL allowlist before
it can replace this safer boundary.

Platform Administrators ordinarily override only the Communication Plan for an
instance they own and only permitted content/timing fields; an unassigned
Platform Administrator uses the explicit audited backstop path. Neither path can
alter global designs, fixed audiences/security triggers, other occurrences or
sent records. Rebase/override operations are audited and exclude
delivering/sent/terminal items.

Exact rendered delivery snapshots contain personal data. Encrypt/protect them as
appropriate, apply explicit retention and field-level support permissions, and
exclude content/variables from broad logs, queue payloads and metrics. Use stable
identifiers in work messages and resolve/render inside the authorized delivery
boundary.

## Visual Analytics Boundary

Analytics filter parameters are selection criteria, not authorization. Every
aggregate and drill-down query reapplies Platform Administrator, organisation,
Access Owner, Coordinator or Presenter scope server-side before calculating its
denominator. Region, offering/version/instance and date filters must not allow a
scoped user to infer excluded cohorts.

Apply minimum-cohort suppression or equivalent disclosure controls to externally
scoped organisation/region views where small counts could identify individuals;
the exact threshold is a privacy/product policy. Drill-down is separately
authorized and may expose fewer fields than an aggregate Platform Administrator
view. Survey-answer content and onboarding demographics do not enter generic
completion charts without an explicit privacy decision.

Validated URL search parameters contain stable filter identifiers only, never
PII or secrets. Chart telemetry/logging excludes filter labels that contain
personal data. Accessible table alternatives preserve the same row/field scope
as the visual result.

CSV export uses the identical authorized semantic query. "All" removes optional
filters but never row/field scope. Broad exports are explicitly confirmed and
audited. Large outputs are written to private expiring objects and reauthorized
at download; possession of an object key or URL is insufficient. Neutralize
spreadsheet formula injection, quote CSV correctly and exclude secrets, access
codes, Survey answers, onboarding demographics and internal notes unless a
separate dedicated permission/schema explicitly includes them.

## SCORM Security Boundary

Treat SCORM packages as untrusted active HTML/JavaScript. Preserve the
dedicated learning origin, absence of the primary application session
cookie, short-lived single-purpose launch credentials stored as digests,
attempt-scoped sessions, re-authorisation of content/progress access,
dedicated security headers, and immutable package versions. Never weaken
the main application's CSP to accommodate SCORM.

## SCORM Upload Security

Use quarantine, upload/expanded-size limits, entry-count limits, ZIP
traversal prevention, manifest/entrypoint validation, rejection of
unsafe structures, immutable extracted prefixes, and asynchronous safe
deletion. Malware scanning may be added if compliance/risk justifies it,
but does not replace archive validation or origin isolation.

## Resource and S3 Security

Validate allowed resource types server-side rather than trusting
extension/MIME claims. Keep learning resources private in S3 and
authorise delivery. Generate object keys server-side. Keep public access
blocked and IAM least-privilege. Presigned URLs, if used, are
short-lived and exact-object/action scoped. Reassess inline-rendering
risk as formats broaden beyond PDF.

## Access-Code Threat Model

Access codes are credentials. Threats include database disclosure,
guessing, logging, over-broad admin retrieval, shared-code leakage, and
replay after revocation. The current product embeds a generated non-secret lookup
ID in each human-readable code, uses it for an ordinary indexed grant lookup,
then AES-256-GCM-decrypts that one candidate and compares the complete submitted
code. The authenticated envelope is bound to its grant and lookup IDs. Versioned
encryption key material remains under the external secret-management boundary;
no separate HMAC lookup key exists. Add redemption rate limiting as policy
requires. Neither plaintext, ciphertext nor key material belongs in generic
logs, reports, queue payloads or audit metadata. The public lookup ID never
proves possession.

## Enterprise Shared Codes

Blanket enterprise codes can be especially valuable. Combine possession
with verified identity eligibility where contract policy allows
(verified domains or future SSO), and support rotation without changing
contract identity or historical entitlements.

## Stripe and Payment Integrity

Preserve signature-verified webhooks, locked/idempotent reconciliation,
purchaser/session/amount/currency checks, exact purchased-version
snapshots, and no fulfilment from browser success redirects. Treat
webhooks as replayable. Never trust client-submitted prices or product
identifiers for fulfilment.

Apply the same boundary to Access Owner capacity extensions: authorize the
active assignment, resolve extension eligibility and price server-side, bind the
Checkout Session to a pending extension order, and increase capacity only from a
verified idempotent webhook. Never allow blanket/100%-covered contracts or an
owner-selected grant identifier to bypass authoritative eligibility checks.

## Validation and Database Integrity

Use runtime schemas such as Zod at server boundaries and parameterised
Kysely queries. Backstop invariants with transactions, row locks,
unique/check constraints for grant/event capacity, fulfilment, enrolment
uniqueness, outbox claims, and completion transitions. UI checks are not
concurrency controls.

## Asynchronous Work Security

Treat queue messages as untrusted versioned inputs. Workers strictly
validate topic/version/payload, reject unknown versions, re-read
authoritative state where appropriate, remain idempotent, minimise
sensitive payload data, and use least-privilege IAM.

## Audit and Logging

Durable audit evidence lives in PostgreSQL and records bounded
actor/action/target/context for significant admin, access-code, event
assignment, attendance correction, contract, publication, privileged
export, and impersonation actions. External logs may receive post-commit
projections but are not the audit system of record.

Never log passwords, session/auth secrets, Stripe secrets/raw payment
data, access-code plaintext, sensitive survey answers, full tokens,
private credentials, or unnecessary PII.

## Secrets, IAM, and Network

Keep runtime secrets outside source control and, where separation
matters, outside the application database. Use Secrets Manager/SSM/KMS
for DB credentials, Stripe/Better Auth secrets, code-encryption keys,
and provider credentials. Do not store an encryption key beside its
ciphertext in PostgreSQL.

Prefer IAM roles over long-lived AWS keys; grant only required
S3/SQS/SSM/Secrets/KMS actions. Keep RDS isolated, security groups narrow,
verified TLS configured for PostgreSQL and public origins, and admin host access
through SSM rather than public SSH. The present single-host/EIP topology is an
explicit cost trade-off; introduce an ALB only with the availability controls
needed to justify it.

## HTTP and Supply Chain

Maintain strong CSP on the primary origin and a separate deliberate
policy on the learning origin, plus HSTS, MIME sniffing protection,
referrer/frame policy as appropriate. Preserve pinned
dependency/lockfile discipline, audit/security verification, dead-code
checks, strict CI gates, and controlled workflow permissions.

## CI/CD and Deployment Integrity

Use least-privilege GitHub Actions permissions and short-lived AWS
federation/OIDC where available. Keep build artifacts immutable and
commit-SHA tied; never expose production secrets to untrusted PR
workflows. Deployment success must prove every intended target received the
release, restarted, passed readiness, and reports the intended release identity.
The same invariant must cover every load-balancer target if the topology is
scaled out later.

## Retention, Backup, and Recovery

Commercial access removal must not casually cascade-delete learning
evidence or audit history. Certificates have no stored history. Define
retention/anonymisation/deletion per data class with appropriate
privacy/legal input. Ensure RDS backup/PITR, S3 lifecycle/versioning
where appropriate, infrastructure-as-code recovery, and tested
restoration procedures. An untested backup is only an assumption.

Onboarding demographics, baseline-knowledge answers and open-entry guest contact
details are separate sensitive data classes. Record purpose, required/optional
status, field-level access and retention explicitly. Guest event pages must not
expose virtual-meeting credentials before validated detail submission; their
occurrence links require high entropy, expiry/revocation, abuse rate limiting and
no credential leakage to logs or referrers.

## Threat Scenarios

- **Stolen session:** secure cookies/TLS, session controls,
  sensitive-action rechecks and monitoring.
- **Learner changes resource ID:** ownership-scoped server queries.
- **Presenter accesses unrelated event:** resource-scoped server
  assignment check.
- **Coordinator changes another region:** occurrence-and-region-scoped server
  assignment check on every read and mutation.
- **Late invitation forwarded:** identity binding, expiry/single-use validation
  and normal eligibility/capacity checks after authentication.
- **Malicious SCORM:** quarantine/validation plus separate origin/no
  primary cookie.
- **Database dump leaked:** access-code ciphertext and public lookup IDs do not
  disclose complete codes without the separately managed environment key;
  private object storage and minimal sensitive persistence constrain other data.
- **Stripe replay:** signature verification + locked idempotent
  reconciliation.
- **Duplicate queue message:** strict schema + idempotent consumer.
- **Admin account abused:** strong auth, least privilege, audit,
  explicit privileged actions, careful impersonation.
- **Malicious email design:** strict HTML/CSS/URL/variable sanitization,
  immutable publication, preview isolation and system-contract validation.
- **Occurrence admin edits global/system email:** occurrence-scoped plan check
  and immutable exact-version ownership on every mutation.
- **Delivery history leaks personal data:** field-level authorization,
  encryption/retention controls and no rendered content in generic telemetry.
- **Enterprise code leaked:** high entropy, eligibility checks, rate
  limiting, expiry/revocation/rotation and monitoring.
- **Open-entry Event link scraped/shared:** high-entropy revocable occurrence
  link, rate limiting, bounded access window, detail capture before join
  disclosure, referrer protection and meeting-provider controls.
- **OTP interception/brute force:** short expiry, one-use digest, bounded
  attempts/resends, account/IP/device controls, provider monitoring and no code
  leakage through telemetry.
- **Facilitated Survey email impersonation:** presenter-window QR, accepted
  Registration match, one-survey capability, non-sensitive eligibility policy,
  provenance and explicit staff-assisted resolution for different emails.
- **Survey QR photographed/replayed:** opaque occurrence-owned reference,
  availability window, server-side item resolution, rotation/revocation,
  participant resolution and single-use submission capability.

## Security Testing

Expand tests for unauthenticated/unauthorised server functions,
ownership isolation, wrong-event scoped permissions, code
brute-force/rate limits, capacity races, webhook tampering/replay, SCORM
traversal/size/manifest attacks, private resource access,
malformed/unknown queue messages, duplicate async delivery, privileged
audit creation, OTP replay/enumeration, shared-device cleanup, cross-participant
capability use, future impersonation, and security headers/CSP across
both origins. External penetration testing is appropriate around major
production/auth/payment/event milestones.

## Security Invariants

1.  **Authentication never substitutes for application authorisation.**
2.  **Sensitive resources are authorised server-side from authoritative
    state.**
3.  **SCORM never receives the primary application session/security
    origin.**
4.  **Payment fulfilment never trusts browser redirects/client prices.**
5.  **Access codes are credentials.**
6.  **Cryptographic keys are separated from protected data where
    required.**
7.  **Queue messages are untrusted versioned inputs; consumers are
    idempotent.**
8.  **Privileged mutations are auditable.**
9.  **Logs/metrics exclude secrets and unnecessary sensitive data.**
10. **Historical learning integrity survives access revocation.**
11. **Resource-scoped roles never silently become global.**
12. **Production deployment integrity is verified across intended
    targets.**

## Recommended Hardening Sequence

### Immediate / pre-production

- extend shared auth abuse protection with WAF when justified by traffic;
- extend deployment verification when moving beyond one host;
- add HTTP and domain-specific observability;
- verify GitHub/AWS least privilege and secret externalisation;
- review CSP/security headers on both origins.

### Events phase

- standard-admin Event ownership plus scoped regional Coordinator and Presenter
  tests;
- regional-list manual/deadline lock, cross-region selection, capacity race and
  historical region-snapshot tests;
- standard-admin/Coordinator/Presenter revocation, historical attribution,
  multi-owner continuation, sole-owner fallback and successor-Template default
  tests;
- late-invitation identity binding, expiry, single use and no-cutoff-only-bypass
  tests;
- open-entry, required-unrestricted and required-restricted Event tests across
  face-to-face or virtual delivery;
- exact normalised matching against verified learner email domains, including
  explicit subdomain behaviour and non-enumerating rejection responses;
- platform-administrator restriction-override authorisation, structured audit,
  idempotency and proof that it bypasses only the domain criterion;
- attendance audit/provenance;
- participant data minimisation;
- capacity concurrency;
- virtual-event credential protection.
- Email Designer privilege, sanitization, required-system-contract and rollback
  tests;
- occurrence-override isolation, unsent-only rebase and preview-no-send tests;
- exact-version/render-snapshot attribution and delivery-history authorization
  tests.

### Enterprise phase

- shared-code hardening/rotation;
- eligibility verification;
- organisation data-scope tests;
- contract audit controls.

### Support phase

- dedicated support inspection;
- then audited/restricted impersonation if still needed.

### Ongoing

- dependency updates/review, penetration testing, backup restoration
  drills, incident-response practice, and threat-model updates when
  trust boundaries change.

## Design Checklist

For a security-sensitive feature ask: What trust boundary changes? What
is the authoritative identity/permission? What data must be exposed?
What runtime validation/database constraint applies? What happens under
replay/concurrency? Does it handle untrusted active
content/files/messages? What secrets/credentials are involved? What must
be audited? What must never be logged? How is failure detected and
recovered?

## Related Documents

Read this alongside Roles and Authorisation, Commerce and Entitlements,
Events, Learning, Content Lifecycle, Transactional Outbox,
Organisations/Contracts, Notifications, Reporting/Observability, and
Product Architecture Review.

## Summary

Upskill already has strong security architecture in its explicit server
boundaries, immutable records, transactional fulfilment, SCORM origin
isolation, private storage, outbox/idempotency, and audit model. The
highest-value hardening is distributed abuse protection, verified deployment
integrity, richer observability, and maintaining least
privilege as Events and enterprise access expand.
