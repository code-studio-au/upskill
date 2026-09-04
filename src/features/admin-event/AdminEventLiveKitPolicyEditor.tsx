import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Alert, Stack, Text } from "#/features/shared/mantine";
import type { AdminEventTemplateItem } from "./admin-event.schema";

type Policy = Extract<
  AdminEventTemplateItem,
  { kind: "session" }
>["liveKitPolicy"];

function PolicyNumberInput({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <MantineTextInput
      type="number"
      label={label}
      value={String(value)}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => {
        onChange(Number(event.currentTarget.value));
      }}
    />
  );
}

export function AdminEventLiveKitPolicyEditor({
  policy,
  durationMinutes,
  disabled,
  onChange,
}: {
  policy: Policy;
  durationMinutes: number;
  disabled: boolean;
  onChange: (policy: Policy) => void;
}) {
  const updatePolicy = (patch: Partial<Policy>) => {
    onChange({ ...policy, ...patch });
  };
  return (
    <Stack gap="sm">
      <div>
        <Text fw={600}>LiveKit webinar defaults</Text>
        <Text c="dimmed" size="sm">
          These versioned settings are copied into each LiveKit Cloud session.
          Attendees remain subscribe-only in the initial webinar release.
        </Text>
      </div>
      <MantineNativeSelect
        label="Admission mode"
        data={[
          { value: "automatic", label: "Automatic admission" },
          { value: "manual", label: "Manual admission" },
        ]}
        value={policy.admissionMode}
        disabled={disabled}
        onChange={(event) => {
          updatePolicy({
            admissionMode: event.currentTarget.value as Policy["admissionMode"],
          });
        }}
      />
      <MantineNativeSelect
        label="Connection attendance"
        data={[
          { value: "manual", label: "Manual only" },
          { value: "automatic_check_in", label: "Automatic check-in" },
          {
            value: "automatic_duration",
            label: "Automatic by connected time",
          },
        ]}
        value={policy.attendanceMode}
        disabled={disabled}
        onChange={(event) => {
          const attendanceMode = event.currentTarget
            .value as Policy["attendanceMode"];
          updatePolicy({
            attendanceMode,
            attendanceMinimumMinutes:
              attendanceMode === "automatic_duration"
                ? Math.min(30, durationMinutes)
                : null,
          });
        }}
      />
      {policy.attendanceMode === "automatic_duration" ? (
        <PolicyNumberInput
          label="Minimum connected minutes"
          value={policy.attendanceMinimumMinutes ?? 1}
          min={1}
          max={durationMinutes}
          disabled={disabled}
          onChange={(attendanceMinimumMinutes) => {
            updatePolicy({ attendanceMinimumMinutes });
          }}
        />
      ) : null}
      <PolicyNumberInput
        label="Presenter preparation window (minutes)"
        value={policy.presenterPreparationMinutes}
        min={0}
        max={1_440}
        disabled={disabled}
        onChange={(presenterPreparationMinutes) => {
          updatePolicy({ presenterPreparationMinutes });
        }}
      />
      <PolicyNumberInput
        label="Attendee rejoin grace (minutes)"
        value={policy.attendeeRejoinGraceMinutes}
        min={0}
        max={120}
        disabled={disabled}
        onChange={(attendeeRejoinGraceMinutes) => {
          updatePolicy({ attendeeRejoinGraceMinutes });
        }}
      />
      <PolicyNumberInput
        label="Staff capacity headroom"
        value={policy.capacityHeadroom}
        min={1}
        max={100}
        disabled={disabled}
        onChange={(capacityHeadroom) => {
          updatePolicy({ capacityHeadroom });
        }}
      />
      <MantineCheckbox
        label="Allow eligible open-entry guests to request admission"
        checked={policy.openEntryGuestsAllowed}
        disabled={disabled}
        onChange={(openEntryGuestsAllowed) => {
          updatePolicy({ openEntryGuestsAllowed });
        }}
      />
      <MantineNativeSelect
        label="Recording mode"
        data={[
          { value: "off", label: "Off" },
          { value: "automatic", label: "Automatic recording" },
        ]}
        value={policy.recordingMode}
        disabled={disabled}
        onChange={(event) => {
          const recordingMode = event.currentTarget
            .value as Policy["recordingMode"];
          const automatic = recordingMode === "automatic";
          updatePolicy({
            recordingMode,
            recordingRetentionDays: automatic ? 90 : null,
            attendeeRecordingNotice: automatic
              ? "This webinar will be recorded."
              : "",
            presenterRecordingNotice: automatic
              ? "This webinar will be recorded."
              : "",
          });
        }}
      />
      {policy.recordingMode === "automatic" ? (
        <>
          <PolicyNumberInput
            label="Recording retention (days)"
            value={policy.recordingRetentionDays ?? 90}
            min={1}
            max={3_650}
            disabled={disabled}
            onChange={(recordingRetentionDays) => {
              updatePolicy({ recordingRetentionDays });
            }}
          />
          <MantineTextInput
            component="textarea"
            label="Attendee recording notice"
            value={policy.attendeeRecordingNotice}
            disabled={disabled}
            onChange={(event) => {
              updatePolicy({
                attendeeRecordingNotice: event.currentTarget.value,
              });
            }}
          />
          <MantineTextInput
            component="textarea"
            label="Presenter recording notice"
            value={policy.presenterRecordingNotice}
            disabled={disabled}
            onChange={(event) => {
              updatePolicy({
                presenterRecordingNotice: event.currentTarget.value,
              });
            }}
          />
        </>
      ) : null}
    </Stack>
  );
}

export function AdminEventLiveKitConfigurationNotice({
  enabled,
  approvedMaxParticipants,
}: {
  enabled: boolean;
  approvedMaxParticipants: number | null;
}) {
  return (
    <Alert
      role="alert"
      color="orange"
      title="LiveKit delivery is not yet available"
    >
      {enabled
        ? `Configuration is present with a participant limit of ${String(approvedMaxParticipants ?? "unknown")}, including staff. Keep this occurrence as a draft until the lobby and webinar workflow is ready.`
        : "Keep this occurrence as a draft. LiveKit configuration and the lobby and webinar workflow must be ready before publication."}
    </Alert>
  );
}
