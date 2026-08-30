# Architecture decision records

ADRs preserve durable decision history. An accepted ADR may describe Target
Product work whose implementation is explicitly pending; current executable
behavior remains identified in the ADR and architecture handbook until rollout
is complete.

| ADR  | Decision                                                                                                                   | Status                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0001 | [TanStack Start application model](0001-tanstack-start-application-model.md)                                               | Accepted                                                   |
| 0002 | [Identity, commerce and authorization](0002-identity-commerce-authorization.md)                                            | Accepted                                                   |
| 0003 | [Versioned learning domain](0003-versioned-learning-domain.md)                                                             | Accepted                                                   |
| 0004 | [SCORM and object storage](0004-scorm-and-object-storage.md)                                                               | Accepted; CloudFront portion superseded by 0036            |
| 0005 | [Mantine, CSP and responsive UI](0005-mantine-csp-responsive-ui.md)                                                        | Accepted                                                   |
| 0006 | [Runtime and dependency cohorts](0006-runtime-and-dependency-cohorts.md)                                                   | Accepted                                                   |
| 0007 | [AWS deployment and verification](0007-aws-deployment-and-verification.md)                                                 | Accepted; CloudFront portion superseded by 0036            |
| 0008 | [SQS worker delivery](0008-sqs-worker-delivery.md)                                                                         | Accepted                                                   |
| 0009 | [Structured logging and durable audit projection](0009-structured-logging-and-durable-audit.md)                            | Accepted                                                   |
| 0010 | [Versioned course authoring and section progress](0010-versioned-course-authoring-and-section-progress.md)                 | Accepted                                                   |
| 0011 | [Versioned surveys and response evidence](0011-versioned-surveys-and-response-evidence.md)                                 | Accepted                                                   |
| 0012 | [Versioned PDF resource library](0012-versioned-pdf-resource-library.md)                                                   | Accepted                                                   |
| 0013 | [TanStack Form and client budget](0013-tanstack-form-and-client-budget.md)                                                 | Accepted                                                   |
| 0014 | [On-demand completion certificates](0014-completion-certificate-issuance.md)                                               | Accepted                                                   |
| 0015 | [Administrator-managed course enrolment lifecycle](0015-administrator-enrollment-lifecycle.md)                             | Accepted                                                   |
| 0016 | [Administrator-managed access-grant lifecycle](0016-administrator-access-grant-lifecycle.md)                               | Lifecycle accepted; storage decision superseded by 0019    |
| 0017 | [Local TLS and HTTP compression](0017-local-tls-and-http-compression.md)                                                   | Accepted                                                   |
| 0018 | [Audited progress overrides](0018-audited-progress-overrides.md)                                                           | Accepted                                                   |
| 0019 | [Encrypted recoverable access codes](0019-encrypted-recoverable-access-codes.md)                                           | Accepted and implemented                                   |
| 0020 | [Stable learning activities and immutable activity versions](0020-learning-activity-versions.md)                           | Accepted                                                   |
| 0021 | [Pre-production schema rebaselining](0021-pre-production-schema-rebaselining.md)                                           | Baseline v1 frozen at migration 0072                       |
| 0022 | [Stable identity and historical attribution](0022-stable-identity-and-historical-attribution.md)                           | Accepted; target adoption is feature-specific              |
| 0023 | [User onboarding and open-entry guest check-in](0023-onboarding-and-open-entry-guest-check-in.md)                          | Accepted; onboarding and initial guest access implemented  |
| 0024 | [Event prerequisite recovery and passwordless access](0024-event-prerequisite-recovery-and-passwordless-access.md)         | Email/SMS OTP task access implemented; fallback pending    |
| 0025 | [Event registration finalisation and staged section release](0025-event-registration-finalisation-and-section-release.md)  | Accepted and implemented                                   |
| 0026 | [Regional Event review, selection and late invitations](0026-regional-event-registration-selection.md)                     | Accepted and implemented                                   |
| 0027 | [Section-embedded automated email plans and occurrence overrides](0027-section-embedded-automated-emails.md)               | Section authoring implemented; delivery automation pending |
| 0028 | [Versioned Event Templates and resilient staff coverage](0028-versioned-event-templates-and-admin-ownership.md)            | Accepted; foundation and initial authoring implemented     |
| 0029 | [Survey-backed versioned user onboarding](0029-survey-backed-versioned-user-onboarding.md)                                 | Accepted and initially implemented                         |
| 0030 | [Standard Survey question types and option authoring](0030-standard-survey-question-types-and-option-authoring.md)         | Accepted and implemented                                   |
| 0031 | [TanStack Table for operational data grids](0031-tanstack-table-operational-data-grids.md)                                 | Accepted and initially implemented                         |
| 0032 | [Typed instants, local schedules and duration semantics](0032-typed-time-model.md)                                         | Accepted and implemented                                   |
| 0033 | [Forward-only Survey branching](0033-forward-only-survey-branching.md)                                                     | Accepted and implemented                                   |
| 0034 | [Source-neutral entitlements and Access Owner disclosure](0034-source-neutral-entitlements-and-access-owner-disclosure.md) | Accepted and implemented for course access                 |
| 0035 | [Bulk-order Checkout and refund preservation](0035-bulk-order-checkout-and-refund-preservation.md)                         | Accepted and implemented for course access grants          |
| 0036 | [Initial authenticated SCORM content delivery](0036-initial-scorm-content-delivery.md)                                     | Accepted and implemented                                   |
| 0037 | [Portable pre-production snapshot fixture](0037-portable-pre-production-snapshot.md)                                       | Accepted and implemented                                   |
| 0038 | [Enterprise blanket contracts as lazy entitlement producers](0038-enterprise-blanket-contracts.md)                         | Accepted and initially implemented                         |
