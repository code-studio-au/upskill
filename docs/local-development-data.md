# Local development data

The comprehensive development seed creates deterministic accounts and realistic
learning, event, onboarding and access-management states. It is local-only and
must never run against a shared or deployed database.

The browser suite continues to use its smaller catalog and learner fixtures in a
disposable PostgreSQL database. Browser verification does not write users,
surveys, emails or untitled authoring drafts into the local development database.

## Reset and seed

Stop any running application or worker, start the Docker services, then pass the
local SCORM 1.2 ZIP file to the aggregate command:

```sh
docker compose up -d
pnpm run db:seed:local -- /path/to/recognizing-eating-disorders.zip
```

`db:seed:local` drops and recreates only the `public` schema of the local
development `/upskill` PostgreSQL database, reapplies migrations and runs the
comprehensive scenario seed. The reset refuses non-local hosts,
non-development environments and any other database name. It does not delete
MinIO objects or ElasticMQ messages.

All credential accounts use `SEED_LEARNER_PASSWORD` from `.env.local`.

## Accounts

### Administrators

| Email                | Event responsibility                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `admin@example.com`  | Default and active administrator for every seeded event.              |
| `admin2@example.com` | Platform administrator with no event template or instance assignment. |

The separation is intentional: it verifies that platform administration does
not implicitly make a person responsible for every Event Instance.

### Learners

`learner1@example.com` through `learner20@example.com` exercise mixed
onboarding, course, entitlement, registration and attendance states.

- Learners 1–16 are onboarded and have course or event activity.
- Learners 17 and 19 have no learning activity but have completed onboarding.
- Learners 18 and 20 have no learning activity and have not completed onboarding.
- Learners with a region are distributed across all 15 operational LHDs.

### Coordinators

Each operational region has exactly one eligible coordinator. The address is
`coordinator.<lowercase LHD code>@example.com`, for example
`coordinator.slhd@example.com`.

| Code    | Operational region                          |
| ------- | ------------------------------------------- |
| CCLHD   | Central Coast Local Health District         |
| FWLHD   | Far West Local Health District              |
| HNELHD  | Hunter New England Local Health District    |
| ISLHD   | Illawarra Shoalhaven Local Health District  |
| MNCLHD  | Mid North Coast Local Health District       |
| MLHD    | Murrumbidgee Local Health District          |
| NBMLHD  | Nepean Blue Mountains Local Health District |
| NNSWLHD | Northern NSW Local Health District          |
| NSLHD   | Northern Sydney Local Health District       |
| SESLHD  | South Eastern Sydney Local Health District  |
| SWSLHD  | South Western Sydney Local Health District  |
| SNSWLHD | Southern NSW Local Health District          |
| SLHD    | Sydney Local Health District                |
| WNSWLHD | Western NSW Local Health District           |
| WSLHD   | Western Sydney Local Health District        |

All operational regions belong to **New South Wales Health (NSW Health)** with
the enforced group code `NSW-HEALTH`. Names follow the
[NSW Health LHD directory](https://www.health.nsw.gov.au/lhd/pages/default.aspx).

### Presenters and Access Owners

| Email                                   | Seeded responsibility         |
| --------------------------------------- | ----------------------------- |
| `presenter.cbte@example.com`            | CBT-E                         |
| `presenter.imed_adults@example.com`     | IMED Adults                   |
| `presenter.sscm@example.com`            | SSCM                          |
| `presenter.fbt@example.com`             | FBT                           |
| `presenter.imed_paediatric@example.com` | IMED Paediatric               |
| `owner.shared@example.com`              | Shared-code access grants     |
| `owner.unique@example.com`              | Single-use-code access grants |

Each Event Template has one presenter and both of its full-day sessions retain
that presenter when Event Instances are scheduled.

## User onboarding

The active seeded onboarding version preserves the current product flow:

1. Personal details.
2. Employment and discipline.
3. Conditional health-service region selection.
4. Experience and confidence ratings.

The operational-region response maps to the user's current profile region. A
learner who does not work for a health service skips region selection.

## eLearning catalog

The five published, store-listed fixtures are modelled on the public
[InsideOut Institute eLearning catalog](https://elearning.insideoutinstitute.org.au/store).
Text is deliberately concise. The single locally supplied **Recognizing Eating
Disorders: A Guide for High School Health Educators** package is ingested once
and reused by every seeded SCORM activity. These are development fixtures, not a
claim of affiliation or a replacement for the source catalog.

| Course                                                                                  | Duration   | Access  | Seeded content                                                          |
| --------------------------------------------------------------------------------------- | ---------- | ------- | ----------------------------------------------------------------------- |
| The Essentials: Training Clinicians in Eating Disorders                                 | 17.5 hours | 92 days | Four pre-learning surveys, six modules and three post-learning surveys. |
| The Foundations of Eating Disorders                                                     | 1 hour     | 14 days | Introductory surveys, one module and evaluation.                        |
| Meal Support in the Hospital Setting                                                    | 4 hours    | 28 days | Four practical modules plus pre/post surveys.                           |
| Eating Disorder Inpatient Management: Adults                                            | 5 hours    | 92 days | Five inpatient-care modules plus pre/post surveys.                      |
| Cognitive Behavioural Therapy (CBT) for Eating Disorders: A Practice Based Introduction | 2 hours    | 28 days | Introduction and practice modules plus pre/post surveys.                |

Learners 1–6 have direct enrollments ranging from not started to complete.
Learners 7–14 have consented access-code entitlements across the four seeded
access-grant variants. This provides both entitled and non-entitled enrollments
for administration and reporting tests.

## Access management

| Label                                             | Kind                | Fulfilment        | Capacity / claimed | Extendable |
| ------------------------------------------------- | ------------------- | ----------------- | ------------------ | ---------- |
| Clinical Training Partner shared bulk access      | Bulk purchase       | Shared code       | 10 / 2             | Yes        |
| Clinical Training Partner single-use resale codes | Bulk purchase       | One code per seat | 8 / 2              | Yes        |
| NSW Health enterprise shared access               | Enterprise contract | Shared code       | 100 / 2            | No         |
| NSW Health single-use contracted access           | Enterprise contract | One code per seat | 6 / 2              | No         |

Codes are deterministic but encrypted in PostgreSQL. Administrators and the
assigned Access Owner can reveal them through the application. Seeded claimants
have information-release acceptance evidence and an entitlement linked to the
exact grant and, for single-use fulfilment, the exact redeemed code.

## Event templates and scheduled events

Five published templates are available:

- Cognitive Behavioural Therapy for Eating Disorders (CBT-E)
- Inpatient Management for Eating Disorders (IMED) Adults
- Specialist Supportive Clinical Management (SSCM)
- Family-Based Treatment (FBT)
- Inpatient Management for Eating Disorders (IMED) Paediatric

Every template contains:

- pre-event confirmation and reminder emails;
- consent, prerequisite SCORM and pre-event surveys;
- two 9:00 am–5:00 pm workshop sessions;
- one template-specific presenter;
- post-event feedback surveys and completion email;
- multiple LHD regions with the matching region coordinator; and
- only `admin@example.com` as its default Event Administrator.

Seven published Event Instances reproduce useful operational stages around the
August–November 2026 schedule:

| Event Instance                   | Seeded state                                                          |
| -------------------------------- | --------------------------------------------------------------------- |
| CBT-E · 10–11 August             | Delivered; selected/waitlisted learners and attended/absent evidence. |
| CBT-E · 24–25 August             | Selection complete; learners can test pre-event work.                 |
| IMED Adults · 3–4 September      | Regional lists locked and awaiting final administrator decisions.     |
| SSCM · 9–10 September            | Registration closed and awaiting regional coordinator prioritisation. |
| FBT · 16–17 September            | Registration open.                                                    |
| CBT-E · 23–24 September          | Registration open across several regions.                             |
| IMED Paediatric · 10–11 November | Registration open for a later event.                                  |

The scenario seed refuses to run twice without a reset so partial duplicate
authoring or workflow data cannot be mistaken for a valid fixture.
