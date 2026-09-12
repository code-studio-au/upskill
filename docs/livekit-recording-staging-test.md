# LiveKit recording staging test

This runbook verifies the managed recording, private playback and retention
path delivered by ADR 0039. It is a bounded recording acceptance check, not the
full cross-browser and failure-drill work tracked as Slice 8d.

Do not use production credentials or a production LiveKit project. Do not print
Secrets Manager values, temporary upload credentials, signed playback URLs or
learner contact details into command output or test evidence.

## Before deployment

1. Confirm the pull request is merged, the exact `main` CI run passed and its
   Release workflow produced a successful attested artifact.
2. Authenticate with the approved Code Studio AWS Identity Center profile and
   run a CDK diff for `upskill-shared-access-grants`,
   `upskill-staging-storage` and `upskill-staging-application`. Review the diff
   before applying infrastructure. Before the first shared-stack deployment,
   confirm that the account and Sydney Region contain no externally managed S3
   Access Grants instance; an existing singleton requires an ownership/import
   decision. The required staging resources are:
   - the account/Region S3 Access Grants instance;
   - the private, versioned staging recording bucket;
   - the staging recording-prefix Access Grants location and `WRITE` grant;
   - application-role access to request one exact-object upload credential;
   - application-role `GetObject`, version-list and delete access restricted to
     `recordings/*`; and
   - the recording Access Grants account ID SSM parameter.

   If the change set proposes replacing the single application EC2 instance,
   stop the normal update. Use the reviewed maintenance-replacement procedure
   in the repository README so the release, Elastic IP and TLS state are
   restored before staging returns to service; do not accept an incidental host
   replacement merely to provision recording resources.

3. In the `upskill/staging/livekit` secret, confirm—without printing values—that
   the isolated staging project has `LIVEKIT_ENABLED=true`,
   `LIVEKIT_PROJECT_ENVIRONMENT=staging`, a canonical `wss:` URL, API key and
   API secret, plus approved participant and concurrent-room limits.
4. In the staging LiveKit project, configure the signed webhook target as
   `https://staging.codestudio.au/api/livekit/webhook`.

Infrastructure activation and secret mutation are separate operator actions.
They require review of the exact CDK diff and explicit deployment approval.

## Deploy and preflight

1. Dispatch `.github/workflows/deploy.yml` from `main`, selecting
   `latest-successful`, `staging` and `preserve`. Do not reset retained staging
   data for this test.
2. Record the deployed release SHA from the workflow summary. Confirm the
   public readiness endpoint reports that SHA and the worker service is active.
3. On the staging application host, load the protected deployment environment
   and run:

   ```sh
   set -a
   . /opt/upskill/shared/upskill-deploy.env
   set +a
   cd /opt/upskill/current
   sudo -u ec2-user --preserve-env /usr/local/bin/node scripts/validate-runtime-environment.ts
   sudo -u ec2-user --preserve-env /usr/local/bin/node --import tsx scripts/verify-livekit-connectivity.ts --recording
   ```

   The second command checks the staging LiveKit server API and confirms that
   the Access Grants-backed recording runtime can be constructed. It neither
   starts a room nor requests an upload credential.

## Create the test event

Create a fresh Event Template version after staging recording is enabled, then
publish a fresh occurrence. Recording policy is snapshotted into the Event
Session, so an older occurrence with recording off is not suitable.

Use one short virtual LiveKit session with:

- automatic recording;
- a one-day retention period;
- explicit presenter and attendee recording notices;
- a short presenter preparation window and scheduled duration;
- manual admission; and
- one assigned presenter, one occurrence administrator and one test learner.

Use approved staging-only accounts and avoid real learner data.

## Acceptance sequence

1. Open the presenter green room and confirm it is not recording.
2. Open the learner lobby and confirm the recording notice appears before room
   access.
3. Start the webinar. Confirm the persistent live/recording indicators and admit
   the learner.
4. Verify presenter and learner media, then end the webinar normally.
5. Wait for webhook or worker reconciliation. In Event Operations confirm the
   recording reaches **Ready** with completion time, duration, size and
   retention deadline.
6. Select **Play** and confirm authenticated playback starts. Select
   **Download** and confirm the private MP4 is delivered through the application.
   Do not copy either short-lived URL into the evidence report.
7. Start a second playback or download, then request deletion from another
   administrator tab. Confirm the active response is cancelled, Play and
   Download disappear immediately, the recording remains visible as immutable
   history, and storage deletion reaches **Deleted**. Reusing the already-issued
   download URL and starting another playback must both fail.

Capture the release SHA, test occurrence title, browsers, timestamps and visible
status transitions. Capture no tokens, signed URLs, secret values or personal
contact details. Storage-failure retry UI remains covered by automated tests;
do not deliberately weaken staging IAM to manufacture a failure.

## Pass criteria and cleanup

The test passes when the same staging release completes recording, reconciliation,
private playback, private download, immediate access revocation and storage
deletion while retaining operational evidence. End the room, sign out the test
users and leave the occurrence clearly labelled as staging test data. The
one-day retention setting is a backstop; successful manual deletion should
remove the object during the test.

If any step fails, retain the occurrence and evidence, record only safe failure
codes and timestamps, and inspect application/worker logs plus the LiveKit
project operation before retrying. Do not reset staging or edit immutable Event
Session or recording evidence as a recovery method.
