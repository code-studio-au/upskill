# Local development data

The development seed creates deterministic accounts and realistic learning and
event workflow states. It is local-only and must never run against a shared or
deployed database.

## Reset and seed

Stop any running application or worker, start the Docker services, then pass the
three local SCORM 1.2 ZIP files to the aggregate command:

```sh
docker compose up -d
pnpm run db:seed:local -- \
  /path/to/module-1.zip \
  /path/to/module-2.zip \
  /path/to/module-3.zip
```

`db:seed:local` drops and recreates only the `public` schema of the local
development `/upskill` PostgreSQL database, reapplies migrations, and runs the
catalog, account and scenario seeds. The reset refuses non-local hosts,
non-development environments and any other database name. It does not delete
MinIO objects or ElasticMQ messages.

All credential accounts use `SEED_LEARNER_PASSWORD` from `.env.local`:

- `admin@example.com` is the platform and Event Instance administrator.
- `learner1@example.com` through `learner10@example.com` are scenario learners.
- `coordinator1@example.com` through `coordinator3@example.com` coordinate Test
  North, Test Central and Test South respectively.
- `learner@example.com` and `redeemer@example.com` remain as compatibility
  fixtures for browser and access-grant verification.
- `redeemer2@example.com` owns a ten-place third-party reseller allocation with
  generated single-use codes available under **Access management**.

Learners 1-4 are represented in Test North, learners 5-7 in Test Central and
learners 8-10 in Test South through their occurrence-region registrations. The
current user profile does not yet persist a home region independently of an
Event Instance registration.

## Event scenarios

One published Event Template supplies pre-event and post-event surveys, sample
questions, a workshop session, all three regional coordinator assignments and
the default administrator. Every seeded Event Instance contains Test North,
Test Central and Test South. Five published Event Instances exercise distinct
operational stages:

| Event Instance        | Seeded state                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Registration open     | Registration is open with submitted registrations across all regions.                               |
| Multi-region review   | Registration is closed and each coordinator can prioritise only their region's submitted list.      |
| Regional lists locked | Coordinator reviews and rankings are locked, ready for final administrator selection.               |
| Workshop in progress  | Selected and waitlisted learners have mixed checked-in, attended, absent and unrecorded attendance. |
| Post-event follow-up  | The workshop has occurred and selected learners have mixed attended and absent outcomes.            |

Use **Multi-region review · Awaiting coordinator prioritisation** to verify
regional isolation. Open **Event operations** after signing in with each
coordinator account:

| Coordinator                | Region       | Visible registrations                         |
| -------------------------- | ------------ | --------------------------------------------- |
| `coordinator1@example.com` | Test North   | Learner 1 and Learner 3                       |
| `coordinator2@example.com` | Test Central | Learner 5 and Learner 6                       |
| `coordinator3@example.com` | Test South   | Learner 8 and Learner 9                       |
| `admin@example.com`        | All regions  | All six registrations, grouped across regions |

The coordinator lock deadline is two days after the seed is run, so each
coordinator can approve, decline, rank and lock their own regional list. The
administrator can observe all three lists and make final selections after the
coordinator decisions.

Event learning-activity progress is not yet a persisted learner feature. The
live and post-event fixtures therefore model dates, registration decisions,
participation and attendance; the template contains the real surveys that will
drive section progress when that feature is implemented.

## eLearning scenarios

The seed synchronously validates and ingests all three supplied SCORM archives,
then creates two published, store-listed courses. Both courses contain
pre-eLearning and post-eLearning surveys with sample questions.

| Course                            | Learner   | Seeded progress                                                       |
| --------------------------------- | --------- | --------------------------------------------------------------------- |
| Prevention and Early Intervention | Learner 1 | Pre-survey and first SCORM complete; remaining activities incomplete. |
| Prevention and Early Intervention | Learner 2 | All required activities and enrolment complete.                       |
| Assessment, Diagnosis and Support | Learner 3 | Enrolled but not started.                                             |
| Assessment, Diagnosis and Support | Learner 4 | All required activities and enrolment complete.                       |

The scenario seed deliberately refuses to run twice without a reset so partially
duplicated authoring or workflow data cannot be mistaken for a valid fixture.
