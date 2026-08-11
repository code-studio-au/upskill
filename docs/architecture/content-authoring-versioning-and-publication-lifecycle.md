# Content Authoring, Versioning, and Publication Lifecycle

**Status:** Living domain design document\
**Scope:** Course, SCORM, survey, resource, and future learning-content
authoring; immutable publication; preview; archive; review; and
lifecycle evolution

## Purpose

This document defines how Upskill should manage educational content from
creation through publication and long-term historical retention.

The central rule is:

> **Published learning must remain historically reproducible. Editing
> creates a new version; it does not rewrite what existing learners
> received.**

This principle is especially important in professional healthcare
education, where completion records and later certificate renderings must remain
understandable long after content has changed.

## Architecture Horizons

- **Current Product:** stable Learning Activity identities, common activity
  version envelopes with type-specific SCORM/survey/PDF content, exact-version
  course composition, draft/published authoring, immutable publication, usage
  guards, archive and constrained deletion.
- **Target Product:** consistent preview, dependency visibility, version diff,
  stronger publication validation and event-content configuration built from
  the same immutable activities.
- **Future Possibilities:** approval workflows, scheduled publication,
  localisation, templates and additional activity/resource formats when their
  operational triggers arise.

## Product Context

Upskill content administrators manage several kinds of learning
material:

- courses;
- SCORM packages;
- surveys;
- resources such as PDFs, slide decks, manuals, worksheets, and
  reference material; and
- future learning activity types.

These content types are composed into self-paced courses and,
increasingly, blended instructor-led events.

The authoring model must support change without sacrificing historical
accuracy.

## Current Architectural Strength

The repository already follows the correct pattern for important
learning content: stable identities are separated from immutable
versions.

A stable course or content object answers "what is this thing?" while a
version answers "what exactly did the learner receive at that point in
time?"

This distinction should be preserved and expanded consistently.

## Stable Identity vs Immutable Version

Conceptually:

```text
Course
  -> Version 1 (published)
  -> Version 2 (published)
  -> Version 3 (draft)
```

An existing learner remains enrolled in Version 1 even after Version 2
becomes current.

The same principle applies to SCORM, surveys, resources, and other
content where later mutation would make historical evidence ambiguous.

## Learning Activity and Learning Activity Version

[ADR 0020](../adr/0020-learning-activity-versions.md) names the common boundary
more precisely:

- **Learning Activity** is the stable identity used to organise and administer
  revisions.
- **Learning Activity Version** is one complete published delivery snapshot,
  encompassing the type-specific content, configuration, immutable object
  references and intrinsic completion semantics needed to reproduce it.

The current `learning_activity` and `learning_activity_version` tables provide
the common identity/version envelope. SCORM package version, survey version and
learning-resource version tables are child-content implementations keyed by the
same version identifier. This design avoids one generic content payload while
letting each activity kind retain strong relational and runtime validation.

Draft version content may be edited under its authoring rules. Once published,
any content or intrinsic-rule change creates a new Learning Activity Version.
Offering-specific Section, order and required/optional status belong to the
Course/Event item that references the version. Courses and Events use the same
ordered, titled Section structure.

## Domain Ownership

### Content identity owns

- stable title/catalogue identity where appropriate;
- administrative grouping;
- archive state;
- relationship between versions; and
- current/default published version reference.

### Content version owns

- immutable learner-facing structure/content reference after
  publication;
- publication metadata;
- exact content/activity configuration; and
- historical identity used by enrolments/evidence.

For a Learning Activity Version this ownership includes the complete validated
type-specific delivery contract. Large files remain in object storage, but the
version owns their exact object key/reference, integrity hash and delivery
metadata.

### Learning owns

Which exact version a learner received and the resulting
evidence/progress.

### Events own

How content activities are arranged into an Event occurrence's ordered, titled
Sections while referencing immutable learning-content versions.

## Course Authoring

A course authoring workflow should allow administrators to:

- create a course identity;
- create/edit a draft version;
- configure title/description and learner-facing metadata;
- add/reorder sections;
- add/reorder learning activities;
- reference exact valid SCORM/survey/resource versions;
- configure required/optional behaviour where supported;
- preview the draft; and
- publish deliberately.

Publishing freezes the structural version used by future enrolments.

## Course Version Lifecycle

A recommended lifecycle is:

```text
draft -> published -> superseded/retained
```

The stable course itself may separately become archived.

### Draft

Editable. Not used as the authoritative structure for ordinary learner
enrolments.

### Published

Immutable. Eligible to be resolved for new enrolments according to
product rules.

### Superseded

No longer the default for new enrolments but retained for historical
learners and support.

Do not delete superseded versions merely because a newer version exists.

## Publishing a New Course Version

When changing a published course:

1.  create/clone a new draft version;
2.  make structural/content changes there;
3.  validate all referenced content versions;
4.  preview/test;
5.  publish the new version; and
6.  update the course's current/default published version for future
    enrolments.

Existing enrolments remain unchanged unless a deliberate, exceptional
migration policy exists.

## SCORM Authoring and Versioning

SCORM packages are externally authored artifacts and require a stricter
ingestion lifecycle.

A recommended lifecycle is:

```text
uploaded/quarantined -> processing -> ready | rejected -> retired/deletion lifecycle
```

A ready package version is immutable.

Uploading a new ZIP creates a new package version rather than replacing
extracted files underneath an existing version.

Preserve:

- quarantine before validation;
- safe extraction constraints;
- manifest/entrypoint validation;
- dedicated learning origin;
- immutable S3 prefix per version; and
- asynchronous deletion after references are removed.

## Survey Authoring and Versioning

A survey has stable identity and immutable published versions.

Draft changes may include questions, ordering, validation, labels, or
other survey configuration.

Once published, the question structure used by learner responses must
not mutate. New changes create a new version.

Responses remain tied to the exact survey version completed.

This is critical because changing questions beneath existing responses
can make the data uninterpretable.

The target Survey Designer supports the standard type set and answer semantics in
[ADR 0030](../adr/0030-standard-survey-question-types-and-option-authoring.md).
Option questions support both individual maintenance and bounded bulk paste from
a spreadsheet column. Import previews trimmed rows, preserves their order,
rejects duplicate labels/values and assigns durable option IDs before the draft
is saved. Publishing freezes question types, constraints, option IDs/labels/order
and canonical mappings.

## Resource Authoring and Versioning

A resource has stable identity and immutable file/content versions.

Current implementation is PDF-oriented; the model should expand to other
safe professional-learning file formats without weakening:

- MIME/type validation;
- private storage;
- exact-version references;
- authorised learner delivery;
- immutable historical references; and
- asynchronous deletion.

Replacing a file creates a new resource version rather than overwriting
the object used by existing course/event versions.

## Content References

Published course/Event structures should reference exact immutable Learning
Activity Versions.

Bad historical model:

```text
Course Version -> Survey (whatever its current version is)
```

Preferred:

```text
Course Version -> Learning Activity Version (Survey Version 4)
```

This guarantees reproducibility.

## Draft References

Draft offerings may reference content that is still being prepared, but
publication validation should ensure every required referenced activity
is in a learner-deliverable state.

For example, a course should not publish while referencing a rejected
SCORM package or unpublished survey version.

## Publication Validation

Before publication, validate at least:

- required learner-facing metadata;
- section/activity ordering;
- referenced content exists;
- referenced versions are valid/ready/published as appropriate;
- no prohibited mutable references remain;
- completion requirements are internally coherent; and
- any product-specific prerequisites are valid.

Validation should run server-side inside the publication boundary, not
rely solely on UI validation.

## Preview

Administrators need to preview draft learning before publication.

Preview should reuse as much of the real learner rendering/runtime as
possible while remaining clearly marked as preview and without creating
genuine learner completion evidence.

For SCORM, preview may require a dedicated administrative
attempt/context so package execution can be tested without contaminating
learner records.

## Publication Audit

Publishing content is a significant administrative action.

Audit evidence should capture:

- actor;
- stable content identity;
- published version;
- timestamp; and
- relevant publication transition.

The system should be able to explain who made a version live and when.

## Archive Semantics

Archiving stable content should generally mean:

- hidden from ordinary new discovery/use;
- not selected for new enrolments unless explicitly overridden; and
- retained for historical enrolments, progress, support, and
  later certificate rendering.

Archive is not deletion.

## Deletion

Hard deletion of educational content requires caution.

If an immutable version is referenced by historical learning records,
deleting its database identity or required evidence can make the past
unreconstructable.

Prefer reference-aware retirement and private object cleanup only when
safe.

For S3-backed content, use asynchronous deletion after authoritative
database references establish that deletion is permitted.

## Content Dependency Graph

As authoring grows, it becomes useful to know where a content version is
used.

For example:

```text
Survey Version 4
  -> Course Version 8
  -> Event Template Version 3
```

Before retirement/deletion, administrators should be able to see
active/historical references.

This can initially be a direct database query rather than a dedicated
graph system.

## Version Diff

A future authoring enhancement should allow administrators to compare
versions.

Useful diff information includes:

- metadata changes;
- added/removed/reordered sections;
- added/removed/reordered activities;
- changed SCORM/survey/resource version references;
- completion requirement changes; and
- publication timestamps.

This improves review and support without requiring content to become
mutable.

## Review and Approval Workflow

Do not introduce complex approval workflow until multiple content
contributors actually need it.

When required, a simple lifecycle might become:

```text
draft -> ready for review -> approved -> published
```

Roles/capabilities could later distinguish authoring from publication
approval.

The workflow should wrap immutable versioning rather than replace it.

## Scheduled Publication

Future scheduled publication can allow an approved version to become
current at a specified time.

This should use durable scheduling, not process-memory timers.

At the scheduled time, a worker revalidates that the version is still
eligible and performs the publication transition transactionally with
audit/outbox work.

## Rollback

"Rollback" should usually mean making a previously published immutable
version the current version for **future** enrolments.

It should not rewrite existing enrolments to another version.

This distinction gives administrators a safe recovery mechanism while
preserving historical learner truth.

## Event Content Configuration

Events should reuse the same content versions through learning
activities.

A published event configuration may need its own immutable/versioned
learning-stage structure when historical reconstruction matters.

For example, a completed workshop should remain explainable even if the
event template later changes its pre-work survey or SCORM module.

Each exact Event Section also owns immutable release intent: phase, time anchor,
signed offset/unit, timezone interpretation, optional end/window and any explicit
predecessor-completion gate. Occurrence/Session dates resolve concrete release
instants. Pre-Event, Session, Post-Event and Follow-up are policy phases while the
Section title remains arbitrary learner-facing text. Published rule changes
follow Event versioning; authorized schedule changes recalculate only
not-yet-released instants and retain provenance.

Avoid building event-specific copies of SCORM, surveys, or resources.

## Content Templates

Reusable course/event templates may become useful later, but templates
should create/configure normal domain versions rather than becoming
hidden mutable dependencies.

If an event is created from a template and later the template changes,
the historical event should not silently change with it.

## Content Localisation

If localisation is introduced later, define whether translated content
is:

- separate versioned content;
- a locale variant inside one version; or
- another explicit model.

Do not add localisation abstractions until there is a real product
requirement, but preserve immutable historical references when it
arrives.

## Accessibility

Authoring validation should progressively include accessibility
expectations relevant to platform-owned content, including labels,
headings, descriptive metadata, and accessible resource formats where
controllable.

Third-party SCORM accessibility may be partly dependent on package
authors, but Upskill should not weaken its surrounding learner UI
accessibility.

## Security

Content authoring is privileged.

Apply:

- server-side admin/capability checks;
- strict upload validation;
- private storage;
- safe object keys;
- quarantine for untrusted archives;
- CSP/origin isolation for SCORM;
- audit of significant mutations; and
- least-privilege S3 access.

Do not trust uploaded filenames, MIME declarations, ZIP paths, or SCORM
manifests without validation.

## Operational Observability

Monitor content-processing health, especially:

- SCORM queued/processing/ready/rejected;
- ingestion duration/failures;
- resource upload failures;
- asynchronous deletion failures;
- publication validation failures; and
- scheduled publication failures when introduced.

## Testing Strategy

Test:

- published versions cannot be structurally mutated;
- new publication does not alter existing enrolments;
- exact content-version references are preserved;
- publication rejects invalid/unready references;
- survey responses remain interpretable after later survey
  publication;
- SCORM replacement creates a new version/prefix;
- resource replacement creates a new version;
- archive does not destroy historical learner access/evidence where
  policy permits;
- rollback affects future selection, not historical enrolments;
- authorisation is enforced server-side; and
- concurrent publication cannot produce conflicting current-version
  state.

## Domain Invariants

1.  **Published learning content is immutable.**
2.  **Existing enrolments remain pinned to exact versions.**
3.  **New edits create new versions rather than rewriting published
    history.**
4.  **Published structures reference exact immutable content versions.**
5.  **Learner evidence remains associated with the version actually
    received.**
6.  **Archive is not deletion.**
7.  **Publication is a privileged, auditable transition.**
8.  **Publication validates referenced content server-side.**
9.  **SCORM remains isolated and versioned by immutable extracted
    content.**
10. **Future review/scheduling/template features preserve historical
    reproducibility.**

## Recommended Implementation Sequence

### Now

- Preserve existing stable-identity/immutable-version patterns.
- Keep exact references in course versions.
- Keep publication validation and privileged boundaries explicit.
- Keep SCORM quarantine/immutable extraction.

### Next

- Formalise a consistent content lifecycle vocabulary.
- Improve draft preview.
- Add content dependency/reference visibility.
- Broaden resources beyond PDF as product needs arise.

### Authoring maturity phase

- version comparison/diff;
- scheduled publication;
- clearer archive/retirement tooling;
- review/approval workflow if multiple content roles require it.

### Later

- reusable templates;
- localisation;
- richer content governance;
- more sophisticated preview/staging only if justified.

## Design Checklist

For a new content feature, ask:

1.  What is the stable identity and what is versioned?
2.  Would later mutation make historical learner evidence ambiguous?
3.  What state is editable versus immutable?
4.  What exact versions do published offerings reference?
5.  What must publication validate?
6.  How is preview separated from real learner evidence?
7.  What happens when content is archived or superseded?
8.  Is deletion safe given historical references?
9.  What must be audited?
10. Does the change preserve existing enrolments exactly as delivered?

## Related Architecture Documents

Read this alongside the Domain Model, Learning Domain and Activities,
Events Domain, Roles and Authorisation, Transactional Outbox,
Reporting/Observability, and Product Architecture Review.

## Summary

Upskill already has the most important content-management decision
right: published educational versions are immutable.

Future authoring work should build around that strength---better
preview, review, scheduling, diffs, archive tooling, broader resources,
and event content composition---without introducing mutable references
that make historical professional-learning records impossible to
reconstruct.
