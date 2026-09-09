import { Alert } from "#/features/shared/mantine";

export function AttendeeRecordingNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;

  return (
    <Alert color="blue" title="Recording notice">
      {notice}
    </Alert>
  );
}
