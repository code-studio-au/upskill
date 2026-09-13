# ADR 0041: Progressive web application and offline SCORM delivery

## Status

Proposed.
Date: 2026-09-12

## Context

Upskill currently delivers authenticated SCORM 1.2 Rise packages from a
dedicated learning origin. Every player-shell, runtime, state and package-file
request is authorised online and returned with `no-store`. This preserves the
SCORM isolation boundary but prevents a learner from launching a module after
connectivity is lost.

Learners may need to prepare a course while connected, complete it during an
unreliable or absent connection, and later synchronise progress. Requiring a
native application would add a second application stack and release process.
Treating installation, browser compatibility and offline capability as the same
thing would unnecessarily exclude browsers whose service workers work but whose
installation experience differs.

## Decision

Make the existing TanStack Start application installable as a progressive web
application. Browser access remains the default Upskill entry point. The
installed PWA is the recommended and officially supported experience for
offline learning, and installation is promoted when a learner chooses **Learn
offline**, not as a blocking prompt for every visitor.

Installation precedes the first offline download. The installed application is
the learner's normal Upskill interface both online and offline; learners do not
switch back to a browser to synchronise or view confirmed completion. A first
launch inside the installed application may require online authentication even
when the browser already has an application session.

Preserve separate application and trusted learning-runtime origins, plus an
uncredentialed package-execution site unique to each offline attempt:

- an application-origin service worker provides the installable shell, offline
  navigation and an offline-course index;
- a learning-origin service worker provides the trusted attempt player, verifies
  entitlements, owns the device key and SCORM journal, and never executes
  package scripts;
- each exact-attempt package site has a service worker that stores only its
  immutable package bytes and minimal versioned SCORM API proxy, plus a bounded
  synchronous checkpoint spool for that attempt; it is isolated at both the
  origin and registrable-site/cookie boundary and has no application or learning
  cookies, bearer material or device keys; and
- the origins exchange only versioned, schema-validated messages over explicit
  fixed-origin channels. A launch-specific `MessageChannel` binds the package
  proxy to an already-authorised exact entitlement and attempt on the trusted
  learning origin; package code cannot select or discover another learner
  context.

Use one production frame topology on every supported engine. The installed
application is the top-level coordinator and creates the trusted learning frame
and exact-attempt package frame as direct siblings; the package frame is never
nested inside the learning frame. The application accepts readiness messages
only from the two expected `WindowProxy` objects at their exact origins, creates
a fresh `MessageChannel`, and transfers one port to each sibling. Before
accepting the port, the learning runtime independently resolves the entitlement
from trusted storage and verifies that the requested package origin, package
version and attempt match it. The application sends the package frame no
entitlement, signing key, bearer credential or attempt selector. After handoff,
SCORM traffic travels directly over the transferred sibling channel using the
bounded protocol; the application coordinator does not relay package-selected
identity or authorization data.

The package frame contains its same-origin minimal API host and nested Rise
content, preserving the parent `window.API` discovery expected by SCORM. This
keeps the package frame a direct child of the installed application for Safari's
user-activated Storage Access request while package scripts remain unable to
read application- or learning-origin storage. Hidden drain frames use the same
direct-child package position and the same exact-origin channel handoff, so the
prototype and production persistence paths test the identical topology.

Origin isolation alone is insufficient because sibling origins can set and
receive parent-domain cookies. The package-site provisioning design must provide
a browser-enforced cookie boundary between attempts. Acceptable implementations
include a separately registrable site per active attempt or an opaque-origin
sandbox with an explicitly proven durable SCORM bridge. Header filtering,
host-only application cookies, JavaScript shims and sibling hosts beneath one
registrable domain are not sufficient controls. No package-execution topology
may ship for a browser engine until tests on that engine prove that one package
cannot set or read cookies, storage or service-worker state visible to another
attempt.

The first confirmed offline matrix is installed Chrome or Edge on supported
desktop and Android platforms. Installed Safari web apps on supported iPhone
and iPad platforms are a required qualification target, but are not advertised
as supported until the Storage Access prototype below passes. Compatible
non-installed Chromium browsers may pass the same runtime capability checks,
but are not the recommended offline journey. Embedded and in-app browsers are
unsupported. Online Upskill remains available in supported ordinary browsers,
including Safari, regardless of offline capability.

For the Safari prototype, **Enable offline course** is an explicit learner
action inside the installed web app. The production direct-child package frame includes
only the required sandbox capabilities, including
`allow-storage-access-by-user-activation`, and calls
`document.requestStorageAccess()` from that user activation when the API says
access is absent. A granted request is not treated as proof that Web Storage is
usable: the package frame must immediately pass a bounded synchronous
`localStorage` write, read, replace and delete probe before download. The probe
uses no learner data and the result is recorded only as local capability state.
It is repeated before offline launch, and any denial, exception or mismatch
keeps the module out of **Ready offline** without weakening the per-attempt
origin and cookie-site boundary.

Safari becomes supported only after this flow passes automated and real-device
tests on every supported iOS/iPadOS version for permission denial and renewal,
offline commits, repeated checkpoints, immediate frame and application
termination, device restart, spool drain, multiple isolated attempts, storage
pressure, upgrade and whole-site cleanup. Tests must distinguish a synchronously
staged checkpoint from a trusted imported journal record as defined by ADR 0043.
If WebKit cannot satisfy those gates, the required fallback is an iOS native
container reusing the TanStack application and SCORM protocol with
platform-controlled package storage and keys; moving package code onto a
trusted Upskill origin is not an acceptable fallback.

Before offering a download, use capability checks for service workers, Cache
Storage, IndexedDB, Web Locks and required cryptography. Request persistent
storage where available, inspect the storage estimate, and explain that the
operating system may still reclaim browser-managed data. A download becomes
**Ready offline** only after the shell, runtime, manifest and every package
object have been stored and digest-verified. Partial downloads remain
unavailable and can be resumed or removed.

Do not depend on Background Sync. Synchronisation is attempted when the PWA
starts online, regains connectivity, returns to the foreground, records a
commit while online, or the learner selects **Sync now**. Browser background
facilities may improve timeliness but cannot be required for correctness.

## Rationale

This retains one React/TanStack Start product and one learner experience while
using standard browser capabilities. Separating the two trusted origins from a
unique cookie-isolated site for each offline attempt keeps third-party package
scripts away from application identity, the trusted journal and every other attempt. Explicit
download and verification make offline availability understandable and
testable; relying on opportunistic runtime caching would produce incomplete
modules.

## Alternatives Considered

- **Require a native mobile application.** Rejected for the initial capability
  because it duplicates the application and delivery stack before browser
  limitations justify that cost.
- **Require PWA installation for all Upskill use.** Rejected because catalogue,
  purchasing and ordinary online learning do not require installation.
- **Support offline use only in a normal browser tab.** Rejected as the primary
  journey because reopening the correct tab and preserving storage is less
  predictable for learners.
- **Move SCORM onto the application origin.** Rejected because Rise package
  scripts would weaken the primary CSP and gain an inappropriate proximity to
  application identity.
- **Depend on Background Sync.** Rejected because support and scheduling differ
  across browser engines.
- **Declare installed Safari supported from capability detection alone.**
  Rejected because a Storage Access grant does not itself prove synchronous Web
  Storage behaviour or persistence across the required lifecycle. Safari is a
  required prototype target with explicit release gates and a native-container
  fallback.

## Consequences

Upskill gains a consistent install-and-download journey without losing normal
web access. The repository must build and version the application, learning and
package-worker variants, provision cookie-isolated per-attempt package sites, and
test their upgrade, cleanup and message compatibility. Offline browser support
becomes an explicit compatibility contract rather than an assumption.

Package downloads consume material local storage and require progress,
cancellation, quota and recovery interfaces. An installed application does not
guarantee that the operating system will retain data indefinitely, so the UI
must show download health and never promise permanent availability.

## Invariants / Guardrails

- SCORM package code executes only in an uncredentialed context unique to its
  exact attempt and isolated at both origin and cookie-site boundaries; the
  trusted learning origin never executes it.
- A service worker controls only its own origin and scoped routes.
- Third-party SCORM code receives no Better Auth cookies, offline credentials,
  device keys, direct access to the trusted journal database or storage shared
  with another attempt.
- The package API proxy exposes only the bounded SCORM calls required by the
  supported profile over a launch-specific, exact-attempt-bound channel.
- Offline support does not weaken the application-origin CSP or the existing
  SCORM sandbox and framing policy.
- No module is shown as ready until its complete immutable version is verified.
- Browser background execution is an optimisation, never the only sync path.
- Offline launch requires a browser-enforced cross-context attempt lock; opening
  the same attempt concurrently in another tab or PWA window is denied.
- Offline support is offered only on browser engines whose tested cross-site
  package context provides the required synchronous spool and isolation
  guarantees; a general PWA-installability check is insufficient.
- Online learning and non-learning Upskill functions do not require PWA
  installation.

## Follow-up / Triggers

Revisit the platform matrix after measured learner demand, browser failures or
storage eviction rates. Add Safari only after the Storage Access prototype and
whole-site cleanup flow pass the defined crash, restart and isolation gates. If
they fail, implement the iOS native-container fallback. Consider a broader
native application only when required offline reliability, operating-system
integration or background execution cannot be achieved within the tested web
capability.

## Related Documents

- [ADR 0001: TanStack Start application model](0001-tanstack-start-application-model.md)
- [ADR 0004: SCORM and object storage](0004-scorm-and-object-storage.md)
- [ADR 0005: Mantine, CSP and responsive UI](0005-mantine-csp-responsive-ui.md)
- [ADR 0013: TanStack Form and client budget](0013-tanstack-form-and-client-budget.md)
- [ADR 0036: Initial authenticated SCORM content delivery](0036-initial-scorm-content-delivery.md)
- [Security architecture and threat boundaries](../architecture/security-architecture-and-threat-boundaries.md)
