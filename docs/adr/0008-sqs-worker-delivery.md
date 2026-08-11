# ADR 0008: SQS worker delivery

## Status

Accepted.

## Decision

Commit asynchronous intent to PostgreSQL in the same transaction as the domain
change. A dispatcher leases pending outbox rows, publishes a versioned message
envelope to a standard SQS queue, and marks the row dispatched only after SQS
accepts it. Consumers delete messages only after a terminal, idempotent domain
handler succeeds. Processing failures remain subject to the queue visibility
timeout and move to a dead-letter queue after five receives.

Use ElasticMQ in Docker for local development. It supplies the SQS API,
visibility timeout and dead-letter behaviour without introducing a second queue
client or changing the application boundary. AWS SQS remains the deployed
transport. LocalStack is unnecessary while SQS is the only locally emulated AWS
service, and an in-process queue would not verify the production delivery
contract.

The production build creates a self-contained worker bundle. EC2 runs it as a
separate hardened systemd service with the same generated environment and IAM
role as the web process.

## Consequences

Delivery is at least once: a dispatcher crash after publish or a consumer crash
before delete can produce duplicates. Handlers must therefore remain
idempotent, and message envelopes are versioned independently of database rows.
Queue visibility is extended while long SCORM extraction runs. Operators must
monitor and explicitly replay or discard dead-lettered jobs; silent loss and
automatic destructive cleanup are prohibited.
