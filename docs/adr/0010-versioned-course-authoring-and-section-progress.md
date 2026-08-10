# ADR 0010: Versioned course authoring and section progress

Status: Accepted

## Decision

A course version owns an ordered list of sections. Each section owns ordered
items that reference one exact immutable SCORM package version, survey version
or PDF resource version. Published course versions are read-only. Any reorder,
addition or removal begins by explicitly cloning the latest published version
to a new draft with new section and item identities. The legacy flat
`course_version_module` positions remain a compatibility projection rebuilt
from the draft's ordered SCORM items until all SCORM runtime consumers use item
identities directly.

Administrators may archive a course without changing its versions or learner
history. Permanent deletion is limited to archived courses with neither
enrolments nor order/access-grant references. Reusable modules, surveys and
resources are not deleted with a course.

PDF resources are immutable, SHA-256-addressed objects in the private resource
bucket. An authenticated, same-origin, size-limited admin route accepts only a
validated PDF signature. Learners receive PDF bytes only through an
entitlement-scoped application route; a successful read records completion for
the exact course-version item.

Completion evidence is stored per enrolment and course-version item. SCORM
items use their effective attempt/administrator-override state; survey and
resource items use item progress evidence. Section state is derived on read:
all required items must be complete, or all items when a section has no
required items. Empty sections are incomplete. The derived state is not stored
as a second mutable projection.

## Consequences

Existing enrolments remain reproducible when authors reorganise or remove
content. Section progress cannot drift from its item evidence. Course deletion
is deliberately stricter than an enrolment-only check because paid-order and
access-grant records are business history.

The course editor can reference published survey versions, but the branching
survey designer and response schema remain a separate delivery slice. Their
future implementation must preserve the exact-version and item-evidence
boundaries established here.
