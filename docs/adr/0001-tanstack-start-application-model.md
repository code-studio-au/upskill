# ADR 0001: TanStack Start application model

Status: Accepted

## Decision

Use TanStack Start with file-based Router routes, Zod search validation, route
loaders, typed server functions, full-document SSR and streaming. Select full,
data-only or client-only SSR per route. Keep server-only work behind marked
modules and preserve the application model when targeting Node on AWS.

## Consequences

Public catalog pages are SEO-ready, route inputs remain typed, and deployment
concerns cannot leak database or infrastructure code into browser bundles.
