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

The first slice installs only a public application shell:

- no authenticated document, API response or SCORM package is cached;
- the manifest applies and the worker registers only on mobile form factors;
- the worker is served only on the application origin;
- the learning origin cannot serve the application worker;
- an offline navigation receives a static, strict-CSP fallback that explicitly
  says course downloads and offline progress are not enabled yet; and
- development mode does not register a worker, avoiding stale local routing.

This slice has no database, authorisation, evidence, audit, outbox, certificate,
sign-out or package-execution effect. Rollback must first deploy a cleanup worker
that deletes the application-shell cache and unregisters itself; registration
and static worker assets can be removed after active installations receive that
cleanup version.

## Verification strategy

- Unit-execute the worker to prove its precache allowlist, navigation-only
  interception and offline fallback.
- Browser-test production registration, exact response headers, learning-origin
  denial and offline navigation on mobile Chromium; qualify Firefox Android in
  a native Firefox lane and Safari through Safari WebDriver plus real devices.
- Add policy unit and database integration matrices before entitlement
  activation, including Course/Event equivalence and malicious identifiers.
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
