# ADR 0031: TanStack Table for operational data grids

## Status

Accepted and initially implemented.

## Context

Administrative directories and review queues grow beyond the point where card
grids are easy to scan or paginate. They need consistent column definitions,
server-backed pagination, search that survives navigation, row actions and a
usable narrow-screen representation. The public catalog, ordered learning
content and hierarchical authoring screens have different interaction models
and should not be forced into a generic data-grid abstraction.

## Decision

Growing operational record sets use exact-pinned TanStack React Table `9.1.2`.
The first adoption covers the learner directory, administrator registration
approval, coordinator registration review and event activity history.

The server owns search and pagination for unbounded directories. Route search
parameters are the authoritative state, and TanStack Table uses manual
pagination over the already paginated response. The learner directory returns
20 rows per page and preserves its search query while changing pages.

A shared semantic table renderer supplies headers, cells and accessible
captions. Below the mobile breakpoint it presents each record as labelled rows
without horizontal page overflow. Feature modules continue to own their column
definitions, cell actions and permissions.

TanStack Table remains route- or feature-scoped. Data-grid components are
loaded lazily with the route or tab that needs them and are not imported by the
root shell or public catalog. Plain semantic markup and purpose-built layouts
remain preferred for small static summaries, catalog cards, ordered learning
activities, drag-and-drop authoring and region hierarchies.

## Consequences

The initial implementation measures 836,854 raw JavaScript bytes and 241,802
Brotli JavaScript bytes across the complete client build. Aggregate caps ratchet
to 839 KB raw and 244 KB Brotli, while an 11 KB gzip named cap constrains the
shared conditional table chunk. Root preload, largest-asset and per-route
incremental limits remain unchanged.

Course rosters, learner enrolment history and per-session attendance rosters
are the next suitable migrations. Each should gain a bounded server query and
URL-backed pagination where the record set can grow. Nested recent-redemption
previews, staff eligibility summaries and content/catalog cards should remain
purpose-built until their workflows require those capabilities.

## Quality attributes

- Server pagination prevents the browser from receiving unbounded directories.
- Search and page state are shareable, refresh-safe URLs.
- Semantic captions and headers remain available to assistive technology.
- Mobile layouts do not require horizontal page scrolling.
- Route splitting and deterministic bundle gates constrain dependency cost.
