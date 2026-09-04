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

The initial Enterprise Contract vertical is isolated in `/admin/contracts`,
with learner materialisation controls confined to the existing course-detail
route. The administrator form, lifecycle actions and course selection plus the
small learner action increased the complete lazy all-route output by no more
than 17 KB of JavaScript and 5 KB Brotli. Those two total caps ratchet by the
measured amounts; root preload, CSS, largest-asset and per-route limits remain
unchanged.

Completing that vertical added code rotation, renewal, exact-email CSV
eligibility, consent-gated bulk fulfilment, scheduled-Event access and bounded
Access Owner reporting. The measured all-route increase over the initial slice
is 11.5 KB JavaScript and 2.7 KB Brotli, so the corresponding caps ratchet by
12 KB and 3 KB. The new work remains route-scoped: root preload, CSS,
largest-asset and per-route caps do not change.

The first-class Event foundation initially kept `/admin/events` route-scoped and
loaded its Template and occurrence authoring dialogs only when opened. This
reduced the parent route chunk from 17.45 KB to 7.12 KB, with separate 3.22 KB
and 6.59 KB conditional chunks. The complete all-route build nevertheless
gained the new product workflow and measured 620,840 bytes raw and 180,414
bytes Brotli. The corresponding total JavaScript caps therefore ratcheted by 20
KB raw and 5 KB Brotli. Root preload, largest-asset and per-route incremental
caps remained unchanged.

The later administration navigation pass split that tabbed workspace into
route-scoped Event Templates and Scheduled Events pages plus a dedicated Event
Settings page beneath `/admin/events`. Event Template and scheduled-instance
authoring now have distinct URLs and client chunks; the `/admin/events`
compatibility entry redirects to Scheduled Events. Event Settings retains
conditional boundaries around its Staff and Regions panels. Direct links from
instances to their exact template versions remain available, and the editors
remain outside the root application preload.

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

The Event Staff eligibility roster and hierarchical Coordination Region
directory are separate conditional chunks loaded only from their corresponding
Event administration tabs. The complete all-route build measures 701,738 raw
JavaScript bytes and 203,536 Brotli bytes after adding the server-backed staff
autocomplete, exact regional Coordinator eligibility and region-directory
forms. Aggregate caps therefore ratchet by 16 KB raw and 6 KB Brotli. Named
2.25 KB gzip caps constrain each new conditional chunk; root preload,
largest-asset and per-route limits remain unchanged. The Template loader returns
only eligible candidates and already-referenced historical staff, never the
full User directory.

The staff email field uses Mantine's CSP-safe `Autocomplete`, including its
Combobox, Popover and floating-positioning dependencies, rather than an
application wrapper or native datalist. The measured cost is intentionally
contained in the already conditional Event Staff roster chunk; it does not
enter the public or root preload boundary. The complete all-route build measures
801,936 raw JavaScript bytes and 231,030 Brotli bytes, while the conditional
Staff roster chunk measures 32.15 KB gzip. Its explicit cap therefore ratchets
to 34 KB, and aggregate caps to 803 KB raw and 233 KB Brotli. Root preload,
largest-asset and per-route limits remain unchanged.

Event occurrence scheduling now has a dedicated route/view instead of a large
modal, and template staffing reuses one searchable, eligibility-bounded picker
for administrators, Presenters and regional Coordinators. Registration review
rows use one compact decision control rather than four stacked actions. After
removing a heavier menu implementation, consolidating occurrence configuration
into its existing route and simplifying the shared picker, the complete
all-route build measures 866,722 raw JavaScript bytes and 252,278 Brotli bytes.
The aggregate caps therefore ratchet by 2 KB raw and 2 KB Brotli. Named 4 KB
and 1 KB gzip caps constrain the occurrence editor and eligible-staff picker;
root preload, largest-asset and per-route limits remain unchanged.

The assigned-event Progress table derives per-participant attendance from the
already-authorised session attendance read model without another query or
client entry point. Aggregate Progress and Attendance summary cards were later
removed so the tab begins with its filters and participant table. The compact
attendance detail remains inside the existing conditional Progress chunk.

Coordinator eligibility revocation now performs a transactional active-instance
coverage check and returns affected occurrence-regions when a sole Coordinator
must first be replaced. The administrator guidance remains inside the existing
conditional Event Staff roster chunk. The complete all-route build measures
870,328 raw JavaScript bytes and 253,160 Brotli bytes, increases of 1,168 and
342 bytes respectively. Aggregate caps therefore ratchet by 2 KB raw and 1 KB
Brotli; the existing Staff roster conditional ceiling and all root, route,
largest-asset and CSS limits remain unchanged.

Separating Event Templates and Scheduled Events into independent routes adds
explicit navigation and route-manifest entries while keeping Event Staff and
Regions behind conditional imports on a compact Event Settings route. The
complete all-route build measures 872,656 raw JavaScript bytes and 254,347
Brotli bytes. Aggregate caps therefore ratchet by 1 KB raw and 1 KB Brotli;
root preload, route-incremental, largest-asset, CSS and named conditional limits
remain unchanged.

The Event Staff responsibility field uses Mantine `NativeSelect` instead of
application-composed toggle buttons. Because the component reuses the Input
styles already loaded by the staff autocomplete and remains inside the lazy
Staff panel, the measured all-route build is 873,390 raw JavaScript bytes and
254,592 Brotli bytes. The raw aggregate cap therefore ratchets by 1 KB; Brotli,
root preload, route-incremental, CSS and named conditional limits remain
unchanged.

The event staff autocompletes also load Mantine's `ScrollArea` stylesheet at
their conditional component boundaries. This prevents inactive native-looking
horizontal and vertical tracks from appearing in the options popover while
retaining vertical scrolling when a result list actually overflows. The
measured all-route build is 873,414 raw JavaScript bytes, 254,609 Brotli
JavaScript bytes, 94,768 raw CSS bytes and 20,438 Brotli CSS bytes. All existing
JavaScript, CSS, root, route and named conditional limits remain unchanged.

Removing the aggregate Progress and Attendance summary cards, together with
their unused count derivation, reduces the complete all-route build to 871,684
raw JavaScript bytes and the conditional Progress chunk to 2.42 KB gzip. The
raw aggregate cap therefore ratchets down by 2 KB and the Progress conditional
cap returns from 3 KB to 2.5 KB gzip. Other limits remain unchanged.

The Schedule New Event page now presents the existing occurrence form as four
responsive, task-focused cards for identity, dates, delivery and registration.
It keeps edit and reschedule behaviour in the existing lazy occurrence-editor
boundary; open-entry events omit registration-only controls and required
registration reveals them in place. The complete all-route build measures
875,501 raw JavaScript bytes, 254,996 Brotli JavaScript bytes, 97,097 raw CSS
bytes and 20,915 Brotli CSS bytes. The raw aggregate cap therefore ratchets by
4 KB and the named occurrence-editor cap from 4 KB to 5 KB gzip. Root preload,
route-incremental, Brotli, CSS and all other named limits remain unchanged.

Event scheduling now derives a city-searchable `Event timezone` catalogue from
the runtime's supported IANA timezones and keeps the persisted canonical
identifier. A lightweight, styled datalist avoids shipping a static timezone
dataset or making the scheduling route depend on Mantine's much larger rich
combobox and scroll-area runtime. The complete all-route build measures 876,793
raw JavaScript bytes and 255,605 Brotli JavaScript bytes. The aggregate raw and
Brotli caps therefore each ratchet by 1 KB, and the named occurrence-editor cap
from 5 KB to 5.25 KB gzip. Root preload, route-incremental, largest-asset, CSS
and all other named conditional limits remain unchanged.

LiveKit provider selection and versioned session-policy authoring reuse the
existing occurrence and programme editors. The detailed policy controls and
provider notice are split into one shared conditional module; the occurrence
editor remains below its existing limit. The complete all-route build measures
1,005,008 raw JavaScript bytes and 292,210 Brotli JavaScript bytes. The raw
aggregate cap therefore ratchets by 2 KB, the programme-editor shell from 3.25
KB to 3.5 KB gzip for its loader and state handoff, and the new LiveKit policy
chunk receives a 1.5 KB gzip cap. Root preload, route-incremental, Brotli, CSS,
largest-asset and all other named conditional limits remain unchanged.

## Consequences

Validation, dirty/touched state and loading behavior now have one consistent
form lifecycle across authentication, access-code redemption, admin creation,
SCORM/PDF upload, course and survey designers, and learner survey responses.
Server boundaries still validate independently. Search URLs remain shareable
and progressively navigable. The production bundle gate retains its raw and
gzip architectural limits and also enforces Brotli wire totals, so future
TanStack Form upgrades must prove their client cost before promotion.
