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

Preserve the separate application and learning origins:

- an application-origin service worker provides the installable shell, offline
  navigation and an offline-course index;
- a learning-origin service worker provides the attempt player, SCORM runtime
  and exact immutable package files; and
- the two origins exchange only versioned, schema-validated status messages
  through an explicit `postMessage` allowlist. SCORM state and offline
  credentials remain on the learning origin.

The first supported offline matrix is installed Chrome or Edge on supported
desktop and Android platforms and installed Safari web apps on supported iPhone
and iPad platforms. Compatible non-installed browsers may pass the same runtime
capability checks, but are not the recommended offline journey. Embedded and
in-app browsers are unsupported. Online Upskill remains available in supported
ordinary browsers regardless of offline capability.

Before offering a download, use capability checks for service workers, Cache
Storage, IndexedDB and required cryptography. Request persistent storage where
available, inspect the storage estimate, and explain that the operating system
may still reclaim browser-managed data. A download becomes **Ready offline**
only after the shell, runtime, manifest and every package object have been
stored and digest-verified. Partial downloads remain unavailable and can be
resumed or removed.

Do not depend on Background Sync. Synchronisation is attempted when the PWA
starts online, regains connectivity, returns to the foreground, records a
commit while online, or the learner selects **Sync now**. Browser background
facilities may improve timeliness but cannot be required for correctness.

## Rationale

This retains one React/TanStack Start product and one learner experience while
using standard browser capabilities. Two origin-scoped workers preserve the
security boundary established by ADR 0004 instead of moving third-party package
scripts onto the application origin. Explicit download and verification make
offline availability understandable and testable; relying on opportunistic
runtime caching would produce incomplete modules.

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

## Consequences

Upskill gains a consistent install-and-download journey without losing normal
web access. The repository must build and version two service workers and test
upgrade behaviour across two origins. Offline browser support becomes an
explicit compatibility contract rather than an assumption.

Package downloads consume material local storage and require progress,
cancellation, quota and recovery interfaces. An installed application does not
guarantee that the operating system will retain data indefinitely, so the UI
must show download health and never promise permanent availability.

## Invariants / Guardrails

- The learning origin remains the only origin that executes SCORM package code.
- A service worker controls only its own origin and scoped routes.
- Third-party SCORM code does not receive Better Auth cookies, offline
  credentials or direct IndexedDB access outside its sandboxed content frame.
- Offline support does not weaken the application-origin CSP or the existing
  SCORM sandbox and framing policy.
- No module is shown as ready until its complete immutable version is verified.
- Browser background execution is an optimisation, never the only sync path.
- Online learning and non-learning Upskill functions do not require PWA
  installation.

## Follow-up / Triggers

Revisit the platform matrix after measured learner demand, browser failures or
storage eviction rates. Consider a native application only when required
offline reliability, operating-system integration or background execution
cannot be achieved within the tested web capability.

## Related Documents

- [ADR 0001: TanStack Start application model](0001-tanstack-start-application-model.md)
- [ADR 0004: SCORM and object storage](0004-scorm-and-object-storage.md)
- [ADR 0005: Mantine, CSP and responsive UI](0005-mantine-csp-responsive-ui.md)
- [ADR 0013: TanStack Form and client budget](0013-tanstack-form-and-client-budget.md)
- [ADR 0036: Initial authenticated SCORM content delivery](0036-initial-scorm-content-delivery.md)
- [Security architecture and threat boundaries](../architecture/security-architecture-and-threat-boundaries.md)
