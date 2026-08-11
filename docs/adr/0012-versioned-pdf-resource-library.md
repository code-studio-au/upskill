# ADR 0012: Versioned PDF resource library

## Status

Accepted.

## Decision

PDF learning resources use a stable resource identity with immutable versions.
Administrators manage the shared library at `/admin/resources`, where an upload
can create a resource or append a version. Course-version items reference one
exact resource version; changing the library never rewrites a draft, published
course or learner record.

An administrator may remove a resource version only when no course-version item
references it. This includes draft and published course versions. Removing the
last version also removes the stable resource identity. The database deletion,
durable administrator audit event and object-cleanup outbox message commit in
one transaction.

The content worker validates the versioned work envelope and deletes only the
immutable `resources/{resourceVersionId}/{sha256}.pdf` object from the private
resource bucket. Cleanup is idempotent and uses the same SQS visibility, retry
and dead-letter behavior in AWS and ElasticMQ locally.

## Consequences

Historical references remain reproducible and cannot be broken from the
library UI. Database state cannot claim a version was removed while losing its
cleanup instruction, and an object-store outage delays cleanup without rolling
back the committed domain change. Storage removal is eventually consistent,
so operational monitoring must surface repeatedly retried or dead-lettered
cleanup work.
