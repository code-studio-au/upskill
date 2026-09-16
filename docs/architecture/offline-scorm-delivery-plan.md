# Offline SCORM Delivery Plan

**Status:** Accepted architecture; staged implementation in progress

**Scope:** Installable application shell, delegated offline access, trusted
local SCORM evidence and idempotent server reconciliation

## Problem and outcome

Learners need to prepare exact SCORM modules while connected, continue them
without a reliable connection and later reconcile progress without weakening
the existing application/learning-origin boundary or historical evidence.

The accepted design is defined by ADRs 0041 through 0044. Delivery is split so
that no intermediate pull request grants partial offline authority, exposes a
credential to package code or claims server-confirmed completion from local
state.

## Owning boundaries

- The application origin owns installation, offline navigation and learner
  coordination.
- The Learning domain owns entitlement issuance, writer-mode transitions,
  trusted local evidence and reconciliation policy.
- PostgreSQL remains authoritative for accepted progress, completion,
  certificates, audit and downstream events.
- Each exact-attempt package site is an uncredentialed execution and staging
  boundary. It does not own identity, entitlement or trusted evidence.

## Impact matrix

| Dimension               | Required coverage                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actors and scope        | One authenticated mobile learner and one registered phone or tablet installation initially; administrators may inspect or hard-revoke retained entitlement state but cannot remotely erase a disconnected copy; SCORM package code is always untrusted.                                                                    |
| Entry and acquisition   | Existing Course and Event SCORM launch paths, a future explicit **Learn offline** action, installed-PWA startup/foreground/manual sync, device replacement, download removal and managed sign-out. Catalogue, checkout and ordinary online use remain unchanged.                                                           |
| Targets                 | One exact SCORM attempt, immutable Learning Activity Version, owning Course Version item or Event Template Version item, exact package digest/runtime and isolated package site. Surveys, resources, payments and administration remain online.                                                                            |
| Lifecycle               | Installable shell; unsupported/capable; downloading/partial/verified; entitlement active/expired/revoked/replaced/resolved; local staged/imported/pending/acknowledged/conflicted; package site active/cleanup-pending/cleared.                                                                                            |
| Qualification           | Current authenticated ownership, ordinary launch policy, released exact item, ready package, finite authoritative access expiry, one active writer, registered device key and the tested browser capability/isolation matrix.                                                                                              |
| Outcomes                | Allow online-only use; require installation; allow/resume/remove download; deny unsupported or concurrent use; issue/replace/resolve entitlement; reconcile/acknowledge/retry/conflict; block sign-out until sync or authoritative cleanup.                                                                                |
| Downstream effects      | Attempt/item/section/offering completion, certificate eligibility, audit/outbox transitions, learner/support status and package-site cleanup inventory. Local completion never directly triggers server consumers.                                                                                                         |
| Failure and concurrency | Forged/cross-scope identifiers, stale launch/session credentials, duplicate commit IDs, mismatched fingerprints, sequence gaps, competing attempt mutation, browser termination between spool/import/signing/receipt, quota/eviction, unavailable package site, expired or hard-revoked entitlement and duplicate cleanup. |

## Central server decisions

Implementation must establish these shared server-owned boundaries before
multiple callers are activated:

1. An offline launch policy resolves authoritative Course or Event context and
   returns a typed allow/deny outcome plus the finite intended launch expiry.
2. One locked attempt-writer transition issues or resolves an entitlement and
   invalidates every incompatible online credential generation atomically.
3. Every ordinary launch and progress mutation uses the same attempt lock and
   refuses writes while the offline writer is active.
4. Offline reconciliation is a separate authenticated, signature-verified and
   idempotent evidence boundary. It does not reconstruct launch authorisation
   from the browser request.
5. Completion, audit, outbox and certificate eligibility remain inside the
   existing server transaction after evidence is accepted.

Course and Event acquisition paths may translate a shared policy outcome into
different presentation, but must not independently recreate the eligibility or
writer-mode rules.

## Reviewable delivery slices

1. **Application shell foundation.** Accept the ADR set; complete the
   mobile-scoped manifest; register an application-origin-only worker on mobile
   form factors in production; cache only a static public fallback; add no
   learner data, offline controls or SCORM authority.
2. **Dormant server model.** Add forward-only entitlement, attempt revision,
   writer mode, device-key, reconciliation-receipt and cleanup-inventory
   schema plus generated types and database invariants. No route issues an
   entitlement.
3. **Central policy and writer transition.** Implement Course/Event policy
   coverage and lock all equivalent online launch/session/progress callers.
   Keep issuance unreachable until the full denial/concurrency matrix passes.
4. **Reconciliation command.** Add canonical encoding, signature verification,
   ordered receipt processing, exact retry recovery and existing completion
   transaction integration behind an unreachable server boundary.
5. **Trusted local runtime.** Add versioned IndexedDB schemas, device key,
   reservation/signing/finalisation recovery and status vocabulary without
   executing third-party package code on the trusted origin.
6. **Isolated package prototype.** Prove distinct registrable-site/cookie
   isolation, exact-attempt Web Locks, bounded synchronous spool, digest-checked
   package caching, direct-sibling channel binding and authoritative whole-site
   cleanup on the supported Chromium matrix.
7. **One complete Course path.** Activate explicit installation/download,
   offline launch, foreground/manual sync and cleanup for self-paced Course
   SCORM on the confirmed matrix.
8. **Event and support paths.** Reuse the same policy and evidence boundaries
   for released Event SCORM; add device replacement, hard revocation, conflict
   inspection and managed sign-out/account switching.
9. **Qualification and rollout.** Add crash/restart/upgrade/storage-pressure
   browser coverage, operational metrics and a bounded activation. Safari stays
   unsupported until the ADR 0041 real-device prototype gates pass.

Each slice must update this plan and current-state documentation. Dormant slices
must not expose routes or UI that imply a later invariant already holds.

## Current slice

The application-shell foundation is implemented and remains deliberately
public-only:

- no authenticated document, API response or SCORM package is cached;
- the manifest applies and the worker registers only on mobile form factors;
- the worker is served only on the application origin;
- the learning origin cannot serve the application worker;
- an offline navigation receives a static, strict-CSP fallback that explicitly
  says course downloads and offline progress are not enabled yet; and
- development mode does not register a worker, avoiding stale local routing.

The dormant-model slice adds the server-owned storage boundaries needed by
later commands:

- SCORM attempts now carry a non-regressing progress revision, writer mode,
  credential generation and exact active-entitlement reference while every
  existing attempt remains in online mode;
- one retained installation identity binds one learner to one immutable P-256
  public key, with a single active mobile installation per learner initially;
- offline entitlements are exact learner, attempt, package digest, installation,
  runtime, history-base and deadline records, with at most one active offline
  writer per attempt;
- reconciliation receipts enforce one immutable fingerprint per commit and one
  accepted record per client sequence; and
- cleanup inventory retains the exact package-site origin until an
  authoritative clearing receipt reaches a terminal state.

Database triggers protect immutable identity and terminal evidence, validate
the authoritative attempt owner and package digest, require credential rotation
for writer changes and prevent reconciliation cursors from regressing. Runtime
database roles cannot delete retained offline evidence or mutate receipts.

The current central-policy slice now:

- resolves Course and Event SCORM launch qualification through one typed,
  server-owned policy while holding the authoritative enrolment or
  participation lock;
- permits offline delegation only when that policy supplies a finite access
  expiry, which currently means eligible Course enrolments; Event policy is
  covered but deliberately returns no invented post-event close instant;
- locks the exact attempt and rotates its credential generation when the
  dormant entitlement command establishes the offline writer;
- revokes live online sessions and rejects launch-token exchange, player and
  content authorization, and progress mutation with an
  `offline_writer_active` outcome while that writer owns the attempt; and
- advances the attempt revision for each material online progress transition
  so a later entitlement captures a stable history base under the same lock.

The entitlement command remains a server-only dormant boundary. No route
registers an installation or invokes it, and no learner UI exposes download or
offline launch controls.

The dormant reconciliation slice now:

- strictly parses a maximum 16-record exact-entitlement batch and shares one
  versioned fixed-position canonical encoding with the future trusted runtime;
- verifies the retained P-256 SPKI identity and each IEEE P1363 device signature
  before entering the state-changing transaction;
- resolves and compares exact Course/Event item, attempt, runtime, package
  version and package-digest bindings;
- serializes owner, entitlement and attempt locks, recovers exact receipts
  before current lifecycle gates, refuses commit-identifier reuse and leaves
  sequence gaps retryable without reserving them;
- applies only contiguous history, advances total time from signed deltas,
  preserves completion monotonically and advances the entitlement cursor with
  the attempt revision; and
- reuses the existing Course and Event completion transaction helper so
  authoritative audit, outbox and communication effects remain idempotent.

The command remains a server-only dormant boundary: there is no sync route,
client journal, installation-registration route or learner control. The next
slice is the trusted local runtime and must not activate offline package
execution before its storage, recovery and signing matrix passes.

The application-shell rollback still must first deploy a cleanup worker that
deletes the application-shell cache and unregisters itself; registration and
static worker assets can be removed after active installations receive that
cleanup version. The dormant database model is retained as forward-only history
until a later expand-and-contract migration can prove removal safe.

## Verification strategy

- Unit-execute the worker to prove its precache allowlist, navigation-only
  interception and offline fallback.
- Browser-test production registration, exact response headers, learning-origin
  denial and offline navigation on mobile Chromium; qualify Firefox Android in
  a native Firefox lane and Safari through Safari WebDriver plus real devices.
- Add policy unit and database integration matrices before entitlement
  activation, including Course/Event equivalence and malicious identifiers.
- Run `pnpm run db:verify:offline-scorm-model` to prove installation,
  entitlement, writer-generation, receipt-idempotency and cleanup-lifecycle
  constraints while the model remains unreachable.
- Add deterministic crash-point tests across spool, import, signing,
  reconciliation and receipt recovery.
- Run `pnpm run verify:app` for every application slice,
  `pnpm run verify:db:gate` for schema/domain slices and the SCORM browser
  partition for every activated learner path.

## Related decisions

- [ADR 0041: Progressive web application and offline SCORM delivery](../adr/0041-progressive-web-app-and-offline-scorm-delivery.md)
- [ADR 0042: Device-bound offline learning entitlements](../adr/0042-device-bound-offline-learning-entitlements.md)
- [ADR 0043: Offline SCORM runtime and local progress journal](../adr/0043-offline-scorm-runtime-and-local-progress-journal.md)
- [ADR 0044: Idempotent offline SCORM reconciliation](../adr/0044-idempotent-offline-scorm-reconciliation.md)
- [Security architecture and threat boundaries](security-architecture-and-threat-boundaries.md)
