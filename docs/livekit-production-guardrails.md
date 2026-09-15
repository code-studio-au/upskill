# LiveKit production guardrails

This runbook defines the minimum alerting contract for routine LiveKit use. It
does not enable LiveKit, approve a provider plan or authorise a production
deployment.

## Ownership and signals

The on-call platform operator owns the CloudWatch alarms and the LiveKit Cloud
billing observation. Event administrators and presenters remain the operational
actors for an exact Event Session; alerts link them back to Event Operations
rather than placing attendee, presenter, room or credential identifiers in
CloudWatch.

The five-minute host monitor publishes low-cardinality `Upskill` metrics for:

- provider probe availability;
- active rooms, connected participants and active managed Egress jobs;
- utilisation against reviewed project limits;
- coalesced attendee or presenter capacity denials in the last ten minutes;
- terminal managed Egress failures in the last ten minutes; and
- the current month-to-date spend observation and its freshness.

CloudWatch sends each alarm to the existing environment-specific operational
SNS topic. When LiveKit is enabled, a failed provider probe or missing/stale
spend observation publishes a breaching value. A total host-monitor failure is
already covered by the application-readiness alarm. Error and saturation
metrics use bounded M-of-N evaluation so one partial collection interval does
not page unnecessarily.

## Configuration before enablement

1. Confirm the selected LiveKit Cloud project plan and record its tested limits
   in the environment's `upskill/<environment>/livekit` secret:
   `LIVEKIT_APPROVED_MAX_PARTICIPANTS`,
   `LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS`,
   `LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS` and
   `LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS`.
2. Obtain approval for the maximum month-to-date LiveKit spend in AUD. Synthesize
   and review the CDK change with
   `--context liveKitApprovedMonthlySpendAud=<amount>`. The default is zero, and
   runtime validation deliberately rejects LiveKit enablement while it remains
   zero.
3. Confirm the operational SNS email subscription and alarm actions in the
   target environment.
4. Record the current billing observation as root on the application host:

   ```bash
   sudo /usr/local/sbin/upskill-record-livekit-spend-observation YYYY-MM AMOUNT_AUD
   ```

   The command writes a root-owned `0600` JSON file under
   `/opt/upskill/shared`, rejects another billing month, and immediately runs the
   monitor. Repeat this after reviewing LiveKit billing at least once every 24
   hours and after material webinars. The freshness alarm activates after two
   missed five-minute observations.

LiveKit documents project quota and metered-resource values in its project
settings and billing dashboard. Its Analytics API is restricted to Scale plans
and exposes session usage rather than a general current invoice total, so the
initial spend control intentionally uses a reviewed billing observation instead
of estimating cost from incomplete application data:

- <https://docs.livekit.io/deploy/admin/quotas-and-limits/>
- <https://docs.livekit.io/deploy/admin/billing/>
- <https://docs.livekit.io/deploy/admin/analytics-api/>

## Alarm response

| Alarm                      | Immediate response                                                                                                                                                             | Resolution evidence                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Provider probe             | Keep attendees in the application lobby. Check LiveKit status, project selection and credentials before retrying.                                                              | Two successful probe intervals.                                                              |
| Quota exhausted            | Stop starting rooms or Egress jobs. Inspect current participant, room and Egress counts plus recent capacity denials. Drain obsolete work or obtain a reviewed limit increase. | Counts below the approved boundary and no new denial.                                        |
| Participant saturation     | Preserve admission headroom. Inspect active sessions and expected registrations before admitting more attendees.                                                               | Participant utilisation remains below 80% for two of three intervals.                        |
| Concurrent-room saturation | Inspect room lifecycle and close stale provider rooms through existing idempotent controls. Do not bypass the room-creation coordinator.                                       | Room utilisation remains below 80% for two of three intervals.                               |
| Managed Egress failure     | Keep the webinar running. Inspect the exact recording in Event Operations and its provider job; reconcile before retrying or exposing output.                                  | Failure is investigated and no new terminal failure occurs in the rolling ten-minute window. |
| Approved spend             | Pause new LiveKit activation and publication. Review the provider bill, active sessions and recording usage; obtain explicit approval before raising the threshold.            | A reviewed CDK threshold or reduced billing exposure, plus a fresh observation.              |
| Spend observation stale    | Refresh from the LiveKit billing dashboard. Do not infer spend from participant duration or stored recording size.                                                             | Two fresh five-minute publications for the current billing month.                            |

## Verification evidence

For a deployment candidate, retain:

- the reviewed CDK diff showing the non-zero approved spend threshold and the
  alarm actions;
- the environment-specific provider limit values without credential material;
- one test alarm delivery to the operational subscription;
- CloudWatch metric timestamps for a successful provider probe and fresh spend
  observation; and
- a bounded staging exercise proving capacity denial and failed-Egress signals
  transition the expected alarms without exposing identifiers.

Do not record secrets, access tokens, room names, participant identities or
contact details in this evidence.
