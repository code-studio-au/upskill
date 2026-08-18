# ADR 0035: Bulk-order Checkout and refund preservation

## Status

Accepted and implemented for course access grants.

## Decision

Bulk pricing is immutable course-version content. Each enabled course defines
ascending minimum quantities with a strictly lower per-seat price at every
tier. An initial order uses the tier reached by its requested quantity. A
capacity extension uses the tier reached by the grant's resulting total
capacity, applying that price only to the newly purchased seats.

Initial buyers choose either one reusable shared code or one unique single-use
code per seat. Upskill snapshots the exact course version, quantity, unit
price, fulfilment mode, organisation, grant label and code prefix before
creating a hosted Stripe Checkout Session. Checkout-generated invoices are
enabled. The signed webhook locks the order and is the sole fulfilment
authority: it creates the grant and buyer's scoped Access Owner assignment, or
locks the existing grant and appends capacity. Single-use extensions append new
numbered codes; shared-code extensions retain the existing code.

Only an active assignment to a finite bulk-purchase grant may initiate a
reorder. The grant must be customer-extendable, unexpired and unrevoked. An
exhausted grant remains eligible because purchasing more capacity is its normal
recovery path. Enterprise blanket coverage and administratively fixed grants
cannot be reordered.

Stripe refund records are stored idempotently and roll up to paid, partially
refunded or refunded order state. A refund never decrements grant capacity,
deletes or disables issued codes, revokes an entitlement, removes an enrolment,
or erases learning evidence. Codes may already have been distributed outside
Upskill, so financial recovery and access intervention are separate explicit
administrative decisions. An abandoned or expired unpaid Checkout creates no
grant or code.

## Consequences

- Stripe retries and concurrent duplicate delivery cannot duplicate capacity or
  codes because the order and grant rows serialize fulfilment.
- Order, payment, refund and invoice history remains visible to the assigned
  Access Owner even after a financial adjustment.
- Published pricing stays reproducible for later reorders because grants remain
  pinned to the purchased course version.
- Commercial support can refund a payment without silently invalidating access
  already supplied to learners.
