# ADR 0032: Typed instants, local schedules and duration semantics

## Status

Accepted and implemented for event scheduling and access expiry.

## Context

An Event is authored as a local wall-clock schedule in a named timezone, while
registration, release, attendance and audit decisions need unambiguous instants.
Storing only a UTC timestamp loses what the administrator entered. Storing only
a local time makes daylight-saving transitions and comparisons ambiguous.
Adding `24 hours` is also not always the same operation as adding one calendar
day.

Browser support for Temporal is not a safe application-wide baseline. The
configured Node 26 server runtime does provide native Temporal, so time
arithmetic can be centralized without shipping a client polyfill or expanding
the root bundle.

## Decision

Application boundaries use these explicit ISO 8601 representations:

| Meaning               | Representation                                                      | Example                    |
| --------------------- | ------------------------------------------------------------------- | -------------------------- |
| Exact instant         | Canonical UTC ISO string ending in `Z`                              | `2027-08-20T23:00:00.000Z` |
| Local calendar date   | ISO date without a timezone                                         | `2027-08-21`               |
| Local wall-clock time | ISO local date-time without an offset                               | `2027-08-21T09:00:00`      |
| Timezone              | Canonical supported IANA identifier                                 | `Australia/Sydney`         |
| Duration              | Amount plus an explicit unit, converted to ISO duration server-side | `1 calendar month`         |

PostgreSQL `timestamptz` remains the source for exact instants. Event
Occurrences and Sessions additionally retain the authored local value and IANA
timezone. Reschedule history retains both the previous and next local schedule,
timezone and resolved instants. This preserves author intent and makes future
timezone-rule drift detectable.

The server-only time kernel uses native Temporal. It resolves local schedules
with `disambiguation: reject`: skipped and repeated daylight-saving wall-clock
times must be corrected by the administrator rather than silently shifted or
guessed. Server commands verify that every submitted local value resolves to
the paired exact instant before writing either value.

Event Section releases store `releaseOffsetAmount` and
`releaseOffsetUnit`. Minutes and hours are elapsed durations. Days, weeks and
months are calendar durations evaluated in the Event timezone. A calendar day
therefore preserves wall-clock time across daylight-saving changes, while 24
elapsed hours preserves elapsed time. Session durations, SCORM token lifetimes
and enrolment-duration days are intentionally elapsed durations.

Date-only access-grant expiry is a documented UTC calendar-date boundary and
resolves to the final millisecond of that UTC date. Survey date answers remain
date-only values and are formatted without applying the viewer's timezone.

Temporal and database `Date` values never cross a TanStack server-function
boundary. DTOs contain ISO strings; browsers use `Intl.DateTimeFormat` for
locale-sensitive display. `Date` adapters exist only at PostgreSQL and
third-party boundaries. Tests cover skipped/repeated transitions, including a
non-hour Lord Howe transition, and calendar-versus-elapsed arithmetic.

## Consequences

- Event edits and reschedules cannot retain a stale instant after a local-time
  or timezone change.
- Historical schedules retain both the administrator's wall-clock intent and
  the exact instant used for operational decisions.
- Release rules express business meaning instead of encoding every duration as
  minutes.
- The client bundle does not include Temporal or a timezone database.
- A future timezone-rule update can compare stored local intent with the newly
  resolved instant and require an explicit reviewed reschedule if they differ.
- All new time arithmetic must go through the server time kernel; direct
  millisecond arithmetic is limited to presentation-only browser code.

## Quality attributes

- Correct across daylight-saving gaps, overlaps and non-hour transitions.
- Explicit, testable calendar-versus-elapsed duration behavior.
- Stable ISO transport contracts and locale-correct browser presentation.
- No client polyfill or root-preload cost.
