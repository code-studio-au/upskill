# ADR 0027: Section-embedded automated email plans and occurrence overrides

## Status

Accepted target; implementation pending.

## Context

Course and Event communications currently exist conceptually as a separate list
from the Sections and activities they support. That makes it difficult for an
administrator to review the complete learner journey while authoring an
offering. An email reminding participants to complete a pre-event Survey, for
example, is operationally part of that stage even though it is not educational
content and produces no learning progress.

Administrators also need to reuse professionally designed emails, preview them
in context and customize an email for one Event Occurrence without altering the
source Event Template or other occurrences.

## Decision

### Reusable email designs

Upskill will provide a separate **Email Designer**. An **Email Design** is the
stable reusable identity and an immutable **Email Design Version** contains the
published subject, sanitized HTML/text content, compatible context, declared
variables and version metadata. Draft editing and publication follow the same
stable-identity/immutable-version discipline as other reusable authored content.

The designer presents two governed catalogues:

- **Offering Emails**, which authorized offering authors can select for
  Automated Email Items; and
- **System Emails**, which a Platform Administrator with a dedicated
  system-communication capability can review, preview and revise.

Each System Email has a stable code-owned key and contract defining its trigger,
recipient resolver, required variables, mandatory content/security constraints
and preference classification. An administrator edits content and allowed
presentation fields, not those behavioral boundaries. A safe default active
version is always retained; publishing an invalid or contract-incompatible draft
fails without replacing it.

Variables use an allowlisted, typed context contract, for example learner full
name, Event Occurrence title, Session start in the occurrence timezone or safe
dashboard URL. Arbitrary object/property traversal, executable expressions,
scripts, event handlers and unvalidated HTML/style injection are forbidden.
Publishing validates every placeholder, required fallback and supported
recipient/context combination.

The editor may present friendly tokens such as `[User full name]`, while the
version stores a stable key such as `user.fullName`. Variable contracts are
versioned. Display-label changes do not rewrite templates, and a key cannot be
removed while a published template/plan, notification intent or retained render
record depends on it. A breaking contract change requires a new contract version,
reference verification and an explicit migration/rebase path.

### Section item, not Learning Activity

Course and Event Template Sections may contain an ordered union of:

- **Learning Activity Item**, referencing an exact Learning Activity Version;
  or
- **Automated Email Item**, referencing an exact published Email Design Version
  plus recipient, trigger, timing and condition policy.

The administration UI presents both in the Section timeline, and the author adds
an Automated Email through the same insert interaction used for SCORM, Survey or
Resource items. A dropdown selects a compatible preconfigured email from the
Email Designer. The item can be reordered and previewed in place.

An Automated Email Item is not educational content. It is omitted from the
learner's activity list, produces no Learning Evidence, carries no required or
optional completion state, is excluded from Section/offering progress and never
blocks navigation. Its visual position gives authors useful context but does not
implicitly define send order. Sending occurs only from the item's explicit
trigger/timing rule.

### Trigger, timing and audience

Each item uses allowlisted typed policy rather than arbitrary code:

- a committed domain event, such as final registration selection, Section
  release, an exact activity becoming incomplete/due, completion, reschedule or
  cancellation;
- a scheduled anchor and signed offset, such as seven days before a Session or
  one month after an occurrence;
- an explicit recipient resolver, such as the affected learner, confirmed
  participants, assigned regional Coordinators, Presenters or Event
  Administrators; and
- bounded state conditions rechecked immediately before delivery.

Adjacency to a Survey does not mean "send after this Survey". The author must
select the exact Survey-completion or timing trigger. Domain-event triggers arise
only from committed state. Scheduled triggers persist durable schedules rather
than process-memory timers. At-least-once processing uses a deterministic item,
trigger occurrence, recipient and channel idempotency key.

### Template and occurrence lifecycle

Publishing an Event/Course Template Version snapshots each Automated Email Item's
exact Email Design Version and automation policy. Later Email Designer or Event
Template edits do not silently change a published template or existing Event
Occurrence.

Creating an Event Occurrence materializes its own **Occurrence Communication
Plan** from that exact Event Template Version. The assigned standard Platform
Administrators responsible for the Event Instance view Automated Email cards
among the occurrence's Sections, preview resolved content and may create an
occurrence-local draft override for subject/body and permitted timing fields.
Publishing the override creates a new occurrence-local
immutable revision and transactionally updates only eligible unsent schedules.
It never mutates the reusable Email Design, Event Template, sibling occurrences
or a delivery already sent/terminal.

The UI clearly labels inherited versus locally overridden content and offers an
explicit reset-to-inherited action before delivery. Template or Email Design
updates reach an existing occurrence only through a deliberate reviewed rebase;
they are never live references.

### Preview and send safety

The Email Designer previews with labelled fixture data. Event/Course Template
preview validates the selected design against that template context. Event
Occurrence preview resolves actual occurrence data and an explicitly selected
authorized example recipient where recipient-specific variables are needed.
Preview never enqueues delivery, does not expose another learner's data without
scope and is visually marked as preview.

Scheduled records retain the automation item/revision, trigger and recipient
identities needed to reproduce why a message was sent. Rendered-content
retention is bounded by privacy/support policy; sent history is not rewritten
when an override changes.

### Mandatory and security communications

System email content is reviewable and versioned in the same Email Designer, but
its behavior is not freely authorable. OTP, account verification/setup, security
alerts, mandatory cancellation and other credential/transaction-bearing
messages retain code-owned trigger, recipient and security boundaries. Their
contracts can require placeholders or locked content such as OTP expiry or safe
support guidance. A privileged Platform Administrator may draft, preview,
publish and roll back compatible content versions, but cannot disable the email,
change its audience, remove mandatory fields or convert it into marketing.
Marketing remains separately consented and governed.

### Immutable delivery history and activation

Publishing never edits an active Email Design Version. It creates a new immutable
version and atomically moves the design's active pointer after contract
validation. Rollback activates another already-published version rather than
mutating history.

A domain event that creates a new immediate notification resolves the then-active
compatible System Email Version. An Event/Course Template item, Occurrence plan,
scheduled notification or already-created notification intent pins its exact
version. A later publish affects only newly created bindings/intents by default.
Applying it to eligible unsent schedules requires an explicit previewed rebase;
sent, delivering, terminal or otherwise historically fixed records cannot be
rebased.

Every delivery record retains the exact Email Design Version, automation/system
contract, recipient, trigger/schedule identity, render time and provider message
identifier. It also retains the exact rendered subject and text/HTML snapshot—or
an equivalently complete immutable render-input snapshot—under the defined
privacy/retention policy. A later template, user-name, Event-date or variable
change therefore cannot alter the record of what that recipient received at that
time. A content digest provides integrity checking but is not a substitute for
the reproducible snapshot.

### Rescheduling and cancellation

Occurrence rescheduling recalculates, cancels or supersedes only unsent schedules
from current plan rules. Occurrence/Registration cancellation suppresses
obsolete reminders and creates its required cancellation communication from the
committed cancellation fact. An assigned instance administrator's custom reminder cannot
replace or suppress that mandatory cancellation message.

## Consequences

Authors can understand learning and communication as one coherent journey while
Learning retains clean evidence/completion semantics. Email content is reusable
and versioned, each occurrence can be safely tailored, and sent history remains
explainable. Implementation requires a polymorphic Section item boundary in the
target authoring model, Email Design versioning, communication-plan snapshots,
typed variable/trigger/audience registries, occurrence-local revisions, durable
scheduling, idempotent delivery and preview authorization.
