# LiveKit recovery staging test

This runbook verifies the typed provider-failure and room-generation recovery
controls delivered by ADR 0039. It is the bounded live evidence required by
Slice 8b, not a production activation, alerting exercise or substitute for the
cross-browser and restrictive-network checks tracked separately.

Use only the isolated staging LiveKit project, a fresh staging-only occurrence
and approved test accounts. Do not print API credentials, participant tokens,
opaque lobby references, learner contact details or signed URLs into command
output or retained evidence. Do not rotate shared credentials, weaken IAM or
network policy, edit immutable evidence, patch database state, or deliberately
exhaust shared provider quotas to create a failure.

## Automated recovery rehearsal

Before deploying, run the repeatable database-backed recovery rehearsal:

```sh
pnpm run db:verify:livekit-recovery
```

The rehearsal injects a provider failure and verifies safe error classification
and retry, explicit generation replacement, previous-access revocation, retained
recording history, worker settlement and durable audit evidence. It uses the
repository's disposable verification database and fake provider; passing it does
not complete Slice 8b without the staging drill below.

## Before the staging drill

1. Confirm the pull request is merged, the exact `main` CI run passed and its
   Release workflow produced a successful attested artifact.
2. Record the deployed release SHA. Confirm the staging readiness endpoint
   reports that SHA and the application and worker services are healthy.
3. Confirm, without printing secret values, that the deployed environment
   validation selects the isolated staging LiveKit project. Packaging the host
   connectivity preflight remains part of Slice 8d and is not a prerequisite
   added by this slice.
4. In that staging project, identify the exact room created for this drill by
   its fresh occurrence and start time. Stop if the target is ambiguous.

Deployment, provider administration and any secret or infrastructure mutation
are separate operator actions. They require approval for the exact environment
and target.

## Create the recovery occurrence

Publish a fresh, clearly labelled staging-only occurrence with one short virtual
LiveKit session, manual admission, recording disabled, one assigned presenter,
one occurrence administrator and one test learner. Keep other staging users out
of the occurrence. Use current supported browsers and avoid real learner data.

Recording remains disabled so the drill tests recovery only; managed-recording
acceptance and failure recovery remain covered by the separate recording runbook
and production-guardrail slices.

## Bounded interruption and recovery

1. As the presenter, enter the green room and start the webinar. As the learner,
   enter the lobby, receive admission and confirm two-way media.
2. In the staging LiveKit administration surface, terminate only the exact room
   identified for this drill. Do not change the project, credentials, quotas or
   shared networking. Record the interruption time without retaining the room
   name or participant identities.
3. Confirm both clients lose provider access without exposing a token, provider
   response body or internal room name. Confirm the learner returns to a safe
   unavailable or waiting state rather than receiving fresh room access.
4. In Event Operations, wait for the normal webhook/worker reconciliation and
   record the visible room, provider and retry states. If the application still
   considers the interrupted generation active, end it through the normal
   operator control before proceeding.
5. As an occurrence administrator, select **Recover with new generation**.
   Confirm an assigned presenter cannot perform this ended-room recovery.
6. Confirm the old lobby link or opaque reference no longer grants new access
   and the application issues no further credentials for the previous
   generation. After the bounded credential-expiry window, confirm a previously
   issued credential cannot rejoin. Do not copy either value into evidence.
7. Prepare and start the new generation, admit the test learner and confirm
   two-way media. End the recovered webinar normally and wait for background
   operations to settle.
8. Confirm Event Operations and durable audit history retain the ended/replaced
   generation, the new generation, the provider-system source, the safe
   failure/recovery reason and the initiating recovery staff actor. No evidence
   from the previous generation may be overwritten or reassigned.

If interruption does not reach a recoverable state through normal processing,
the drill fails. Retain the safe evidence and investigate the application,
worker, signed webhook delivery and provider operation; do not repair the result
by editing database state or repeatedly replacing generations.

## Pass criteria

The drill passes only when the same deployed staging release demonstrates all
of the following:

- provider interruption leaves both user journeys safe and leaks no credentials;
- retry and operator status use safe typed states rather than raw provider data;
- only an administrator can recover an ended generation;
- previous lobby references and credentials cannot enter the replaced room;
- the replacement generation can be prepared, started, joined and ended; and
- both generations and the recovery actions remain in durable audit evidence.

## Evidence record

Retain one reviewable report with:

- deployed release SHA and successful `main` CI/Release run links;
- test occurrence title, provider environment and browsers used;
- timestamps for start, interruption, reconciliation, replacement and cleanup;
- visible state transitions and safe audit action/reason names;
- automated recovery rehearsal result; and
- pass/fail outcome, deviations and follow-up issue links.

Exclude internal database identifiers, room names, tokens, opaque references,
signed URLs, secret values and personal contact details. If the drill fails,
keep the occurrence clearly labelled as staging test evidence until diagnosis is
complete. If it passes, end the room, sign out test users and retain only the
sanitised report and normal immutable application evidence.
