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

An ordinary revocation or removal prevents renewal and new online launches but
does not pretend to erase content already stored on a disconnected device. The
issued entitlement remains the record of the authority delegated for its
bounded lifetime. An administrator may hard-revoke server acceptance of a
specific entitlement for a security incident; this cannot make an already
offline copy inaccessible, and the administrative interface must say so.

The entitlement also delegates server acceptance of its correctly signed,
ordered commits until an immutable commit-acceptance deadline no more than 30
days after its intended launch expiry. This is deliberately extended delegated
authority for delayed transport, not evidence that the commits were authored
before access expired. The hard, server-verifiable boundary is that the server
must receive a commit before the acceptance deadline. Server reconciliation
retains both deadlines, receipt time and outcome so delayed evidence is
distinguishable from online progress.

Offline learning is intended for a learner-controlled device. Before download,
the UI warns against public or shared devices. **Remove download** deletes the
package, progress journal and entitlement after pending work is synchronised or
the learner explicitly accepts its loss. Signing out removes personalised
offline state and credentials from that installation; immutable package bytes
may remain only when they are unlinked from learner identity and inaccessible
to a SCORM launch without a valid entitlement.

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

## Invariants / Guardrails

- Entitlements are issued only by a server-owned policy using authoritative
  access, release, registration, package and attempt state.
- Every entitlement identifies one exact immutable activity and offering item.
- At most one active offline writer exists for an attempt.
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
