# ADR 0022: Stable identity and historical attribution

## Status

Accepted. Existing and future features adopt this invariant as their schemas
are implemented; no compatibility with disposable pre-production data is
required.

## Decision

A person has one stable internal user identity. Mutable login/profile
attributes such as email address, display name and current organisational
association are not record identity. Capabilities and resource-scoped
assignments authorize future actions; revoking them must not erase or detach
the records created while they were valid.

Domain records that require attribution store the stable user identifier and
the point-in-time facts needed to interpret or display the historical record.
The exact snapshot is domain-specific: an access-grant redemption retains the
redeemer's email at redemption; an invitation retains its recipient address; an
attendance correction retains its actor and time. Do not copy mutable personal
data when the historical value has no business, support or audit purpose.

Historical relationships remain queryable after access changes. For example:

- ending a presenter assignment removes future presenter access but the event
  occurrence/session continues to list the assigned presenter;
- changing a user's email does not revoke enrolments or completed learning
  obtained through an earlier organisation-domain eligibility decision;
- an Access Owner's redemption list continues to show the email used when the
  learner redeemed that grant, even after the learner changes their account
  email; and
- an open-entry Event retains the guest name/email submitted at check-in even if
  a later verified claim links it to a user whose current profile differs;
- changing a user's current onboarding/profile region after a move does not
  rewrite or reroute an existing Event Registration Region Snapshot or target
  Course Enrolment Region Snapshot; current-region analytics may change while
  participation-time analytics does not; and
- removing administrator, coordinator, presenter, Access Owner or organisation
  capabilities does not orphan authored, assigned, redeemed, attendance,
  progress, completion or audit records; Event owner/Coordinator assignments end
  with retained provenance, while successor Event Template Versions remove
  disabled future defaults without rewriting old versions.

Assignments therefore have lifecycle state such as assigned-at and ended-at or
revoked-at. They are not hard-deleted merely to remove authority. Eligibility
rules are evaluated when the relevant access/registration decision is made and
the decision provenance is retained; ordinary profile changes do not
retroactively re-evaluate established access. An explicit domain command may
revoke or correct the resulting access where product policy permits it.

Authentication and authorization always use current identity state and active
capabilities. Historical snapshots are display/evidence data and never restore
permission, prove current email ownership or authorize a new action.

## Consequences

Schemas must distinguish current user/profile data, active authority,
historical assignment and point-in-time attribution. Foreign keys to a user
must not use mutable email addresses. Account deletion/anonymisation needs an
explicit privacy policy that preserves required referential and audit integrity
without retaining unnecessary personal data.

Read models must intentionally choose current profile data or retained
point-in-time data. This avoids both broken history and the opposite error of
treating an old email or former role as current authorization.
