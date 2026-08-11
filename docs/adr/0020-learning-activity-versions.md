# ADR 0020: Stable learning activities and immutable activity versions

## Status

Accepted.

## Context

Upskill preserves historical accuracy through exact activity versions. Courses
currently compose SCORM package, survey and resource activity versions. Events
will reuse those activity types and add attendance or other future learning
requirements. Referring only to a generic "activity" is insufficient:
historical evidence must identify the exact version content and completion
semantics the learner received.

Forcing every activity into one untyped JSON record would weaken validation and
referential integrity. Keeping only unrelated type-specific terminology would
make common course/Event composition, evidence and completion contracts harder
to express.

## Decision

Use two domain concepts:

- **Learning Activity** is the stable administrative identity across revisions.
- **Learning Activity Version** is the complete, immutable published delivery
  snapshot for one revision of that activity.

A Learning Activity Version has a discriminating activity kind and encompasses
all type-specific content, configuration and intrinsic completion semantics
needed to deliver and later interpret that revision. "Encompasses" describes
aggregate ownership; it does not require binary content or every activity type
to share one physical database column.

The version-content contract is a validated discriminated union. It may be
stored in type-specific tables and immutable object storage while presenting one
domain interface. Examples include:

- SCORM launch metadata, manifest, content hash and immutable object prefix;
- survey sections, questions, instruction blocks and response rules;
- resource object reference, content hash, media type and display metadata; and
- attendance or future activity-specific requirement configuration.

Large files remain in private immutable object storage. The version owns their
exact object references, integrity hashes and delivery metadata rather than
embedding the bytes in PostgreSQL.

A published Course Version or Event Version references exact Learning Activity
Version identifiers through ordered, titled Sections. Offering-specific
composition such as section, order, required/optional status and an intentional
presentation override belongs to the offering item, not the reusable activity
version.

Learner evidence identifies the exact offering item and Learning Activity
Version to which it applies. Publishing a new activity version never retargets a
published offering or existing learner evidence. Any content or intrinsic-rule
change that could alter delivery or interpretation creates a new version.

## Current implementation

`learning_activity` stores the stable identity, title and discriminating kind.
`learning_activity_version` stores the common immutable-version envelope and
publication state. `scorm_package_version`, `survey_version` and
`learning_resource_version` are type-specific child-content tables keyed by the
same version identifier. Composite foreign keys ensure that a child and its
common envelope have the same kind.

`course_version_item` has one `learningActivityVersionId` plus the matching
kind. The database enforces that pair against the common version table, avoiding
three nullable polymorphic references while preserving type-specific runtime
validation. SCORM attempts and survey evidence retain their exact typed version
references because those records belong to the corresponding evidence model.

This clean envelope was introduced by rebasing the pre-production migration
chain under [ADR 0021](0021-pre-production-schema-rebaselining.md). There was no
production or user data to translate. Future activity kinds add a common kind,
their validated child-content contract and their evidence semantics; they do
not require another course-item reference column.

## Consequences

Courses and Events can compose one versioned activity vocabulary while SCORM,
survey, resource and attendance implementations retain strong type-specific
validation. Support and audit views can reconstruct exactly what was delivered,
including the content reference and rules in force at the time.

The design adds an explicit version boundary and requires every new activity
kind to define its version-content schema, evidence contract, completion
semantics and migration compatibility. It deliberately avoids a premature
universal content table or an unvalidated "anything" JSON payload.

This ADR refines the versioning direction in
[ADR 0003](0003-versioned-learning-domain.md),
[ADR 0010](0010-versioned-course-authoring-and-section-progress.md),
[ADR 0011](0011-versioned-surveys-and-response-evidence.md) and
[ADR 0012](0012-versioned-pdf-resource-library.md).
