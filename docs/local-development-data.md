# Local development data

The comprehensive development snapshot preserves the useful current-version
authoring and operational state from the pre-baseline local database. Its
committed relational fixture is deterministic and contains only reserved mobile
numbers. The same fixture may be added once to staging through the separately
guarded operator path; production use is prohibited in code.

The browser suite continues to use its smaller catalog and learner fixtures in a
disposable PostgreSQL database. Browser verification does not write users,
surveys, emails or untitled authoring drafts into the local development database.

## Reset and seed

Stop any running application or worker and start the Docker services. The
ignored asset directory must contain the recovered `private/` and
`scorm-source/` trees before running:

```sh
docker compose up -d
pnpm run db:seed:local
```

`db:seed:local` drops and recreates only the `public` schema of the local
development `/upskill` PostgreSQL database, reapplies migrations and runs the
portable snapshot seed. The reset refuses non-local hosts,
non-development environments and any other database name. It does not delete
MinIO objects or ElasticMQ messages. Asset uploads are content-addressed or use
immutable fixture keys, and an existing object is preserved.

All credential accounts use `SEED_LEARNER_PASSWORD` from `.env.local`.

## Accounts

### Administrators

| Email                  | Event responsibility                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `admin@codestudio.au`  | Default and active administrator for every seeded event.              |
| `admin2@codestudio.au` | Platform administrator with no event template or instance assignment. |

The separation is intentional: it verifies that platform administration does
not implicitly make a person responsible for every Event Instance.

### Learners

`learner1@codestudio.au` through `learner20@codestudio.au` exercise mixed
onboarding, course, entitlement, registration and attendance states.

- Learners 1–16 are onboarded and have course or event activity.
- Learners 17 and 19 have no learning activity but have completed onboarding.
- Learners 18 and 20 have no learning activity and have not completed onboarding.
- Learners with a region are distributed across all 15 operational LHDs.

### Coordinators

Each operational region has exactly one eligible coordinator. The address is
`coordinator.<lowercase LHD code>@codestudio.au`, for example
`coordinator.slhd@codestudio.au`.

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

| Email                                     | Seeded responsibility         |
| ----------------------------------------- | ----------------------------- |
| `presenter.cbte@codestudio.au`            | CBT-E                         |
| `presenter.imed_adults@codestudio.au`     | IMED Adults                   |
| `presenter.sscm@codestudio.au`            | SSCM                          |
| `presenter.fbt@codestudio.au`             | FBT                           |
| `presenter.imed_paediatric@codestudio.au` | IMED Paediatric               |
| `owner.shared@codestudio.au`              | Shared-code access grants     |
| `owner.unique@codestudio.au`              | Single-use-code access grants |

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
The seeded profile section also collects a required mobile number and optional
email/SMS security-code preferences. Learner 4 uses the reserved synthetic
mobile `+61491570006`, has SMS enabled and is deliberately unverified so the
verification flow can be exercised without contacting a real device. Other
stored mobile values also remain in the ACMA reserved fictional range.

## Controlled staging seed

Staging accepts the same relational fixture as an additive, one-time operation.
It preserves an existing account when its email matches a fixture user and
remaps every fixture reference to that existing user ID. A complete prior seed
is a no-op; a partial prior seed fails closed. Delivery captures, notifications,
outbox jobs, sessions, password hashes, access-code ciphertext, Stripe IDs and
verification challenges are not copied.

Create the ignored asset archive locally with `pnpm run seed:assets:package`,
transfer it to the instance through the protected deployment-artifact path, and
extract it to a root-controlled directory readable by `ec2-user`. The active
release installs `/usr/local/sbin/upskill-seed-staging`. That command requires
`/opt/upskill/shared/upskill-seed.env` to be owned by `root:root` with mode
`0600` and to contain:

```dotenv
ALLOW_STAGING_SEED=I_UNDERSTAND_THIS_ADDS_FIXTURE_DATA
SEED_LEARNER_PASSWORD=<a unique value of at least 12 characters>
SEED_ASSET_DIRECTORY=/opt/upskill/shared/current-seed-assets
SEED_SMS_TEST_USER_EMAIL=learner4@codestudio.au
SEED_SMS_TEST_PHONE=<the approved Australian E.164 staging test number>
```

The password and real test number must be supplied through the protected
operator environment and must never be committed, placed in an SSM command, or
printed to logs. The staging phone is inserted as SMS-enabled but unverified,
with no active ownership claim, so the normal six-digit verification path is
tested. The loader rejects the real-number override in development/test and
rejects every seed attempt in production.

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
- only `admin@codestudio.au` as its default Event Administrator.

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

The snapshot seed treats a complete rerun as a no-op and refuses partial fixture
state so duplicate authoring or workflow data cannot be mistaken for a valid
seed.
