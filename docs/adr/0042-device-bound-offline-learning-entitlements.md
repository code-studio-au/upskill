# ADR 0042: Device-bound offline learning entitlements

## Status

Proposed.
Date: 2026-09-12

## Context

The current SCORM attempt session lasts no more than eight hours and is
revalidated against enrolment or Event Participation state on every request.
Offline delivery cannot perform those checks after disconnection. Extending or
caching the existing HTTP-only session would blur online and delegated
authority, provide no package-download lifecycle, and make revocation and
support difficult to reason about.

SCORM `suspend_data` is vendor-owned opaque state. Concurrent offline work on
multiple devices cannot be merged safely. Downloaded state may also contain a
learner identifier, learner name, location, score and vendor-authored suspend
data and therefore requires a deliberate local-data lifecycle.

## Decision

Introduce an explicit **Offline Learning Entitlement** owned by the Learning
domain. It is a time-bounded delegation to one authenticated learner, one exact
SCORM attempt, one exact Learning Activity Version and one registered browser
installation.

The server issues an entitlement only while the ordinary launch policy allows
the learner to use the activity. The entitlement contains or binds:

- a stable entitlement identifier and schema version;
- learner and attempt identifiers;
- the owning enrolment and Course Version item, or Event Participation and
  Event Template Version item;
- the exact SCORM package-version identifier, content digest and runtime
  version;
- a device-held public key and opaque installation identifier;
- an issue instant, intended launch expiry and commit-acceptance deadline; and
- the server progress revision from which offline work begins.

Entitlement issuance is also the atomic transition from ordinary online writes
to the exclusive offline-journal writer. In one transaction, the server locks
the attempt, re-evaluates launch policy and active-entitlement state, revokes
every live SCORM attempt session, invalidates every unconsumed launch token or
older per-attempt credential generation, then creates the entitlement with the
attempt revision visible under that lock. An online mutation already holding
the attempt lock completes first and is included in that captured revision; if
issuance wins the lock first, the competing online mutation observes the new
writer mode and applies no state.

Every ordinary online launch, session-creation and progress-mutation path,
including the existing progress command, acquires the same attempt lock and
rechecks active offline-entitlement state after acquiring it. While an
entitlement is active, those paths reject both newly presented and previously
issued online credentials with an `offline_writer_active` outcome. Possession
of an otherwise unexpired eight-hour session or unused launch token is not an
exception. The registered installation continues online through the signed
offline journal and reconciliation command; it does not use the ordinary online
progress path.

Returning an attempt to ordinary online writer mode is another locked server
transition. It occurs only after pending journal evidence is reconciled, or an
explicit discard, replacement or administrative resolution records its outcome,
and it invalidates the prior offline and online credential generations before a
fresh online launch can be issued.

The browser installation creates a non-exportable Web Crypto signing key. The
server signs the entitlement and binds it to the corresponding public key. The
learning-origin worker verifies the server signature before launching cached
content and signs each queued commit with the device key. Device binding is a
copy-resistance and attribution measure, not DRM and not proof that a learner
personally performed the content.

The entitlement's intended launch expiry is the learner's authoritative access
expiry captured when it is issued. For a course enrolment this is the
enrolment's access expiry. For an Event Participation it is the applicable
server-derived activity-availability boundary. The local runtime refuses a new
launch after this instant, but that check relies on the device clock and is not
server-verifiable proof of when offline work occurred. The server must not issue
an offline entitlement where it cannot determine a finite intended launch
expiry. One attempt may have at most one active offline entitlement. A learner
may replace the registered device while online; doing so revokes the prior
entitlement for future server synchronisation and clearly warns that
unsynchronised progress on the old installation may be lost.

While an offline entitlement is active, the same installation may continue the
attempt online through the offline journal. Another device may view server
progress but cannot start or mutate that attempt without first replacing the
offline device. This exclusive-writer rule prevents competing opaque
`suspend_data` histories.

The registered installation also permits only one live player context for the
attempt. Before loading package code, the exact-attempt package host obtains a
browser-enforced exclusive Web Lock and holds it for the player lifetime. A
second tab, iframe or PWA window does not start another SCORM session while that
lock is held; it reports **This module is already open on this device** and may
offer to focus or close the existing application surface where the platform
allows. Browser or renderer termination releases the lock. Offline capability
is unavailable when the platform cannot provide the required cross-context lock
semantics; a service-worker flag or BroadcastChannel notification alone is not
an atomic substitute.

An ordinary revocation or removal prevents renewal and new online launches but
does not pretend to erase content already stored on a disconnected device. The
issued entitlement remains the record of the authority delegated for its
bounded lifetime. An administrator may hard-revoke server acceptance of a
specific entitlement for a security incident; this cannot make an already
offline copy inaccessible, and the administrative interface must say so. Hard
revocation rejects new evidence but does not hide a durable receipt for an exact
retry of a commit accepted before revocation.

The entitlement also delegates server acceptance of its correctly signed,
ordered commits until an immutable commit-acceptance deadline no more than 30
days after its intended launch expiry. This is deliberately extended delegated
authority for delayed transport, not evidence that the commits were authored
before access expired. The hard, server-verifiable boundary is that the server
must receive a commit before the acceptance deadline. Server reconciliation
retains both deadlines, receipt time and outcome so delayed evidence is
distinguishable from online progress.

Offline learning is intended for a learner-controlled device. Before download,
the UI warns against public or shared devices. Package code may write arbitrary
state on its unique execution site, including cookies unavailable to JavaScript.
Consequently **Remove download** can complete only while online, after pending
work is synchronised or the learner explicitly accepts its loss and an
authoritative response from that exact package site invokes the supported
browser's whole-site clearing mechanism. The cleanup removes its cookies,
storage, caches, service workers and execution contexts before trusted code
deletes the journal, entitlement and device binding. A cached cleanup page or
JavaScript enumeration is not treated as a complete site wipe.

Provisioning an exact-attempt package site also creates a server-retained
cleanup-inventory entry bound to the learner, installation, entitlement and
exact package-site origin. The inventory contains identifiers and cleanup state,
never SCORM values, and is not deleted merely because application- or
learning-origin browser storage disappears. It remains reconstructible to the
cleanup workflow until that exact site has returned an authoritative whole-site
clearing response and the server records its cleanup receipt. Local registries
accelerate discovery but are not the sole record of sites that must be cleared.

Signing out or switching accounts uses the same synchronize-or-explicit-loss
boundary. The application first drains every registered package spool,
finalises signing reservations and synchronises pending journal records through
durable server receipts. If the device is offline or any evidence remains
unacknowledged, ordinary sign-out is paused and the learner is shown the exact
affected downloads with two choices: remain signed in and retry later, or
**Delete offline progress and sign out**. The destructive choice requires a
separate explicit confirmation that the listed unsynchronised progress cannot
be recovered. That choice still requires connectivity: the application obtains
a browser-enforced whole-site clearing response from every registered
exact-attempt package site before deleting the learning-origin journal,
entitlements, device signing key and other personalised offline state. If any
site is unreachable or the supported wipe cannot be confirmed, sign-out and
account switching remain blocked, the application explains how to retry online
and does not claim cleanup succeeded. It must not instruct the learner to clear
only the PWA/application site, because that would erase the local registry while
leaving package sites behind. Closing the PWA or allowing an online session
cookie to expire is not an instruction to delete offline evidence and does not
bypass this flow. Once local sign-out completes, no personalised offline state,
package-site state or signing credential remains.

Offline scope initially includes SCORM activities only. Surveys, research
questionnaires, payments, certificates, administrative functions and other
sensitive workflows remain online.

## Rationale

A separate entitlement makes the unavoidable delayed-revocation trade-off
explicit and auditable. Exact-version binding preserves Upskill's historical
model. A single writer avoids inventing unsafe merge semantics for opaque SCORM
state. Binding intended offline launch to the access already granted to the
learner makes the online and offline product promise consistent, while the
separate server-enforced acceptance deadline states the delayed-sync authority
honestly.

## Alternatives Considered

- **Cache the eight-hour attempt cookie.** Rejected because it is an online
  session, does not describe delegated offline rights, and is not a suitable
  durable client credential.
- **Require renewal every seven or 30 days.** Rejected because it introduces an
  arbitrary online check inside access that the learner has already been
  granted and can prevent completion during an extended disconnected period.
- **Issue an entitlement without a finite access expiry.** Rejected because it
  could make an offline copy launchable indefinitely.
- **Allow the same attempt on multiple offline devices.** Rejected because
  `suspend_data`, location and accumulated time have no safe general merge.
- **Encrypt all package bytes with a JavaScript-accessible key.** Rejected as a
  claim of strong at-rest protection: a browser that can execute the package
  must be able to recover those bytes. Browser origin isolation, bounded
  entitlement and local-data deletion remain the meaningful controls.

## Consequences

Offline launch is intentionally available until the captured access expiry
without a fresh server check. This can be materially longer than seven or 30
days. Administrators and support staff must be able to see active entitlements,
expiry, device replacement and pending or rejected sync state. The product must
explain that remote revocation cannot delete content from a disconnected device.

Learners cannot freely continue one attempt offline on several devices. Device
loss may lose unsynchronised progress. The commit-acceptance window retains data
for recovery but extends delegated server authority beyond the intended launch
expiry. Neither the client timestamp nor the device-clock launch check can prove
that accepted work occurred before access expired.

Sign-out, account switching and download removal require connectivity whenever
an offline package site has been provisioned, including after the learner
accepts loss, because only an authoritative whole-site response can clear state
that package code may have stored outside the managed spool. A learner needing
to clear a disconnected or unreachable device immediately is shown every exact
application, learning and package site from the local and server inventory while
that inventory remains available. Selective browser cleanup must include every
listed site. If that cannot be guaranteed, the only supported emergency action
is the browser or operating system control that clears all website data for the
entire browser profile; clearing only the installed PWA is explicitly unsafe.
Upskill cannot report an in-application sign-out receipt for this out-of-band
action. Remote server-side session termination cannot erase or synchronize a
disconnected installation; on its next authenticated use the installation must
resolve the server-retained cleanup inventory before another learner account
can use that offline workspace.

## Invariants / Guardrails

- Entitlements are issued only by a server-owned policy using authoritative
  access, release, registration, package and attempt state.
- Every entitlement identifies one exact immutable activity and offering item.
- At most one active offline writer exists for an attempt.
- Offline-entitlement issuance locks the attempt, invalidates all prior online
  launch and session credentials, and captures its history-base revision in the
  same transaction.
- Every ordinary online launch and mutation rechecks writer mode while holding
  the attempt lock and rejects all online credentials while an offline
  entitlement is active.
- At most one local player context holds the exact-attempt Web Lock and mutates
  its in-memory state, checkpoint spool or session-time delta.
- Intended offline launch ends at the authoritative finite access expiry
  captured when the entitlement is issued; this client-enforced boundary is not
  treated as server-verifiable evidence.
- Server acceptance ends at the immutable commit-acceptance deadline, enforced
  against the server receipt instant and no later than 30 days after intended
  launch expiry.
- Device secrets, entitlement bearer material and SCORM state never enter logs,
  analytics or durable audit metadata.
- Local browser protection is not described as DRM or equivalent to native
  secure storage.
- Hard revocation changes server acceptance; it cannot promise remote deletion.
- Receipt recovery for a previously accepted exact commit remains available
  after expiry or revocation and never reapplies the domain effect.
- Sign-out, account switching and download removal never discard
  unacknowledged offline evidence or its signing key without successful
  synchronization or the learner's explicit destructive confirmation.
- When an offline package site exists, sign-out, account switching and download
  removal do not complete until an online browser-enforced whole-site wipe has
  cleared that site; JavaScript-managed deletion is insufficient.
- The server retains an exact package-site cleanup inventory independently of
  local browser state until every site has an authoritative cleanup receipt;
  local registry loss cannot silently mark cleanup complete.
- Browser-settings guidance requires every inventoried application, learning
  and package site to be cleared, or all website data for the browser profile;
  clearing only PWA data is never presented as sufficient.
- Completed local sign-out leaves no personalised package-site or trusted
  offline state and no device signing credential available to a later user of
  that installation.
- Research questionnaires and other non-SCORM evidence are not added to offline
  scope without a separate privacy and architecture decision.

## Follow-up / Triggers

Review the access-expiry and one-device policies after a bounded pilot. A
request to support access without a finite expiry, shared managed devices or
multi-device continuation requires product, privacy and security review.
Materially stronger offline content protection requires a native-platform or
managed-device decision rather than additional obfuscation in JavaScript.

## Related Documents

- [ADR 0002: Identity, commerce and authorization](0002-identity-commerce-authorization.md)
- [ADR 0003: Versioned learning domain](0003-versioned-learning-domain.md)
- [ADR 0020: Stable learning activities and immutable activity versions](0020-learning-activity-versions.md)
- [ADR 0032: Typed instants, local schedules and duration semantics](0032-typed-time-model.md)
- [ADR 0041: Progressive web application and offline SCORM delivery](0041-progressive-web-app-and-offline-scorm-delivery.md)
- [Roles, authorisation and operating modes](../architecture/roles-authorisation-and-operating-modes.md)
