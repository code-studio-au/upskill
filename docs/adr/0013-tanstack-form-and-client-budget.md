# ADR 0013: TanStack Form and client budget

## Status

Accepted.

## Decision

Interactive mutation workflows use TanStack Form for authoritative values,
field metadata, validation and submission state. Zod remains the contract
source through Standard Schema validation, and each submission is parsed again
before crossing a server or upload boundary so normalized values are explicit.
Course and learner catalogue filters remain router-backed native GET forms;
they do not need mutation state or client-side form orchestration.

TanStack Form is pinned to `1.20.0`, the newest compatible release before its
core acquired an unconditional browser devtools event dependency. A newer
release can be adopted when tree-shaking or the application baseline permits it
without changing the existing bundle budgets.

The login and sign-out controls call BetterAuth's same-origin JSON endpoints
directly. BetterAuth continues to own credential verification, session cookies,
origin checks and server authorization, while the unused generic browser client
is excluded from the catalogue bundle. Small status badges use a CSP-safe CSS
module and card layouts reuse Mantine `Paper`; these substitutions preserve the
existing total and route bundle limits after adding TanStack Form.

Total client budgets are ratcheted only for measured product growth that cannot
be reduced by route splitting. The admin course learner roster increased the
all-route build by 2,067 bytes of JavaScript and 435 bytes of CSS, so the total
caps moved by 3 KB and 1 KB respectively. Root preload, largest-asset and
per-route incremental limits remain unchanged; dependency changes and features
must continue to satisfy those structural boundaries.

The roster's later administrator enrolment controls remain behind a dedicated
lazy component boundary. They reduced the parent course route while adding a
2.37 KB gzip conditional chunk; the complete all-route build grew by 5,609
bytes of JavaScript and 706 bytes of CSS. Total caps therefore ratchet by 6 KB
and 1 KB. Root preload, largest-asset and per-route caps remain unchanged.

Administrator access-grant management is isolated in the `/admin/access` route,
whose measured incremental JavaScript is 4.91 KB gzip. Its TanStack Form,
responsive lifecycle cards, audited code retrieval and capacity controls
increased the complete all-route output by 16,793 bytes of JavaScript and 2,161
bytes of CSS. Total caps therefore ratchet by 17 KB and 2 KB. Root preload,
largest-asset and per-route caps remain unchanged.

The first-class Event foundation keeps `/admin/events` route-scoped and loads
its Template and occurrence authoring dialogs only when opened. This reduced
the parent route chunk from 17.45 KB to 7.12 KB, with separate 3.22 KB and 6.59
KB conditional chunks. The complete all-route build nevertheless gained the
new product workflow and measured 620,840 bytes raw and 180,414 bytes Brotli.
The corresponding total JavaScript caps therefore ratchet by 20 KB raw and 5
KB Brotli. Root preload, largest-asset and per-route incremental caps remain
unchanged.

The Event rescheduling regional-coverage editor is loaded only after an
administrator opens the already conditional occurrence editor. Region addition,
multi-Coordinator reassignment, affected-registration preview and explicit
retirement disposition increased the measured all-route build by 5,719 raw
JavaScript bytes and 1,992 Brotli bytes. The aggregate caps therefore ratchet by
6 KB raw and 2 KB Brotli. A separate 1.5 KB gzip cap now names and constrains the
`AdminEventRegionalCoverageEditor` conditional chunk; root preload,
largest-asset and route-incremental caps remain unchanged.

The learner event list initially remained behind a dashboard-only lazy
boundary. Separating active registrations, available events and historical
outcomes into responsive counted tabs increased the measured all-route build by
2,549 raw JavaScript bytes and 620 Brotli bytes. The aggregate caps therefore
ratcheted by 3 KB raw and 1 KB Brotli, and the `LearnerEventSection` conditional
chunk gained an explicit 2.25 KB gzip cap.

My Learning and My Events subsequently became separate data and route
boundaries. The `/dashboard` route now loads only eLearning and access-grant
data, while `/my-events` owns event discovery and registration and retains the
conditional `LearnerEventSection` import. The new route shell increased the
measured all-route build from 684,406 to 685,571 raw JavaScript bytes without
requiring a Brotli cap change, so the raw aggregate cap ratchets by 2 KB. A
stricter 4 KB gzip route cap now constrains `/my-events`; root preload,
largest-asset and general per-route incremental limits remain unchanged.

## Consequences

Validation, dirty/touched state and loading behavior now have one consistent
form lifecycle across authentication, access-code redemption, admin creation,
SCORM/PDF upload, course and survey designers, and learner survey responses.
Server boundaries still validate independently. Search URLs remain shareable
and progressively navigable. The production bundle gate retains its raw and
gzip architectural limits and also enforces Brotli wire totals, so future
TanStack Form upgrades must prove their client cost before promotion.
