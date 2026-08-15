# ADR 0028: Versioned Event Templates and resilient staff coverage

## Status

Accepted; relational foundation and initial authoring workflow implemented.

## Context

Event Instance administration requires ordinary platform-administration tools:
user-account troubleshooting, user lookup/provisioning, late invitations,
registration corrections, regional selection, communication overrides and
operational support. Modelling Event Administrator as a separate authorization
role would duplicate and fragment those capabilities.

Event Templates will also change over time. New Sections, learning content,
automation, registration defaults or assigned operational owners must affect
future Event Instances without changing the exact configuration used by existing
instances. Administrators, regional Coordinators and Session/Occurrence
Presenters must support shared responsibility and leave cover.

## Decision

### Standard Platform Administrator authority

Event Instance administration uses the standard **Platform Administrator** role.
There is no separate Event Administrator authorization role or capability
bundle. A Platform Administrator can use the ordinary authorized user-account
support, invitation, Event, registration and communication-management commands
needed for an Event Instance. Any Platform Administrator retains audited
backstop access to any instance.

An Event Instance nevertheless records one or more **Assigned Event Instance
Administrators**. This is operational ownership, not an authority grant: it
controls responsibility dashboards, notifications, escalation and workload
visibility. An assignment authorizes nothing unless that User currently has the
standard Platform Administrator role. Removing that role immediately removes
administrative access while retaining historical attribution to earlier
decisions and assignments.

Published/operational Event Instances must have at least one active assigned
Platform Administrator. Multiple assignments are supported equally for shared
responsibility, workload distribution and leave cover. A standard administrator
may add/end instance assignments through an audited command. Ending an
assignment changes neither the Event Template defaults nor historical actions.

### Platform Administrator revocation

Revoking/disabling the standard Platform Administrator role is an immediate
security boundary and cannot be delayed merely because the User owns Event
Instances or is a Template default. The revocation command performs or schedules
an idempotent impact workflow that:

1. ends the disabled User's active Event Instance owner assignments with source
   `platform_admin_revoked`, retaining their assignment/action history;
2. leaves each instance operating under its other active assigned administrators;
3. adds the explicitly selected active Platform Administrator replacement to any
   affected sole-owner instance; and
4. creates a new immutable successor Event Template Version for every affected
   current Template, removing the disabled default and adding the selected
   replacement where required.

Previously published Event Template Versions remain unchanged as historical
provenance, and existing instances remain pinned to the version from which they
were created. Their current operational-owner records change independently. A
system-generated successor records the revocation as its source and contains no
unrelated content changes. Existing drafts are flagged to rebase/remove the
disabled default before publication.

Security revocation must still succeed if no replacement is immediately
available. In that exceptional case, affected instances are flagged
`administrator_attention_required`, all active Platform Administrators receive
an urgent notification and retain backstop access, and future instance creation
from an affected Template is blocked until a valid successor version with at
least one default administrator is published. Learner access, confirmed
registrations, Event delivery, evidence and scheduled mandatory communications
continue; the system never restores the revoked role automatically.

### Coordinator revocation and regional coverage

Coordinator roster eligibility is scoped to one Coordination Region and used
only to constrain new Template/default selection. The same User may hold
eligibility for multiple regions. Eligibility is not an authorisation grant;
runtime access still requires an active occurrence-and-region Coordinator
assignment.

Each configured Event Instance region similarly supports one or more active
Coordinator assignments. Revoking/ending one assignment or disabling its User
removes future scoped access immediately and retains prior actions. Other active
Coordinators continue using the same regional list.

If the User was the region's sole Coordinator, the impact workflow adds a
selected eligible replacement. Without one, it flags
`coordinator_attention_required`, alerts the instance's assigned standard
administrators and permits their Platform Administrator backstop so review and
lock work remain operable. It does not convert unreviewed registrations into
approvals or alter prior rankings/decisions.

Current Event Templates that reference the disabled Coordinator receive an
immutable successor version removing that default and adding the replacement
where supplied. A Template cannot create a future instance while one of its
configured regions lacks valid Coordinator coverage. Historical versions remain
unchanged and existing drafts must rebase before publication.

### Presenter revocation and delivery coverage

The editable Event Staff roster is eligibility metadata used only to constrain
new Template/default selection. Presenter eligibility is unscoped; Coordinator
eligibility is scoped to a Coordination Region. Neither is a global operating
role or grants Event access. Runtime authorisation continues to require an
active occurrence/session Presenter or occurrence/region Coordinator
assignment. A User removed from the roster remains visible in immutable history,
while drafts and future instances must replace an ineligible default before
publication or creation.

Every presenter-required Event Instance/Session supports one or more active
Presenter assignments. Revoking/ending an assignment or disabling its User
removes future scoped access immediately while retaining the assignment interval,
historical listing and all Attendance/recovery actions attributed to that
Presenter. Other active Presenters continue unchanged.

If the User was the sole Presenter for a required scope, the impact workflow adds
a selected eligible replacement. Without one, it flags
`presenter_attention_required`, alerts the assigned standard administrators and
keeps the digital operational workflow accessible to Platform Administrator
backstop users without falsely recording an administrator as the Presenter. It
does not cancel the Session, alter Attendance or invent delivery evidence.

Current Event Templates that reference the disabled Presenter receive an
immutable successor version removing that default and adding the replacement
where supplied. A Template cannot create/publish a future instance while a
presenter-required Session lacks valid coverage. Historical versions remain
unchanged and existing drafts must rebase before publication.

### Stable Event Template and immutable versions

An **Event Template** is a stable reusable identity. Every publish creates an
immutable **Event Template Version** containing the exact future-instance
configuration, including:

- ordered Sections and Section Items, with exact Learning Activity and Automated
  Email versions;
- release, completion and scheduling-relative rules;
- registration mode/workflow, regional/review and other occurrence defaults;
- one or more default Coordinator User references for every configured region;
- one or more default Presenter User references for the occurrence and/or every
  presenter-required Session definition;
- communication-plan definitions; and
- one or more default Assigned Event Instance Administrator User references.

Editing a Template creates a draft/new version. It never mutates a published
version. Existing Event Instances remain pinned to the exact Event Template
Version from which they were created. Publishing a later version affects only
future creation unless an explicit feature-specific migration is designed and
previewed; there is no implicit live-template relationship.

### Event Instance creation and default staff

Creating an Event Instance from an exact Event Template Version snapshots its
configuration and automatically creates instance assignments for all configured
default administrators, regional Coordinators and Presenters. Default references
use stable User IDs, not email addresses.

Creation rechecks that every administrator default exists and currently has the
Platform Administrator role, and that every Coordinator default remains an
eligible active User for its scope. It also validates one or more eligible active
Presenters for each presenter-required occurrence/Session scope. An invalid
default is never silently granted authority or silently discarded. The creation
workflow identifies it and requires an authorized administrator to select a valid
replacement/override; at least one active assigned administrator, one active
Coordinator per configured region and one active Presenter per
presenter-required scope are required before the instance can be
published/operated. Permanent default changes should be published in a new Event
Template Version.

The Event Instance records each resulting assignment, its source Template
Version/default or occurrence-local addition, assigning actor and active/ended
interval. Later changes to Template defaults do not alter existing instance
assignments. Later instance assignment changes do not alter the Template.

### Related workflows

The assigned standard administrators jointly receive regional-list lock,
reschedule, delivery-failure and other operational notifications. Any of them may
perform capacity-safe final selection, invite/provision users, troubleshoot user
accounts, customize eligible unsent occurrence emails and apply authorized
corrections. Their actions retain the individual actor; shared responsibility
never becomes a generic untraceable administrator identity.

If all assigned administrators lose their standard role or end their
assignments, the instance is flagged as operationally unowned and Platform
Administrator backstop users are alerted. The system requires a replacement; it
does not restore revoked authority or delete historical assignment records.

## Consequences

Upskill retains one coherent administration authorization model while still
making Event ownership explicit. Event Templates become safely reusable and
historically exact, future instances receive default cover automatically, and
existing instances cannot drift when a Template changes. Implementation needs
Event Template identity/version tables, exact-version occurrence provenance,
versioned administrator/Coordinator/Presenter defaults, occurrence assignment
history, active-role validation, administrator/region/presenter coverage
validation and attention monitoring.

This ADR supersedes the separate occurrence-scoped Event Administrator role
described in earlier target wording. ADRs 0025-0027 continue to govern their
registration, communication and release workflows using assigned standard
Platform Administrators.

## Implementation Status

The current implementation establishes immutable Template Versions,
exact-version occurrences and Sessions, ordered Sections and reusable learning
activity references, versioned administrator/Coordinator/Presenter defaults,
occurrence assignment history and publish-time coverage checks. Template
creation is intentionally blank and requires explicit default administrators.
The version designer supports multi-session and region authoring, published
read-only views, and cloned successor versions. Assignment
replacement/revocation automation, registration decisions and attendance
operations remain follow-on work under this ADR.
