export function formatRecordingDuration(durationNanoseconds: string): string {
  const totalMinutes = Math.floor(Number(durationNanoseconds) / 60_000_000_000);
  if (!isFinite(totalMinutes) || totalMinutes < 0) return "Unavailable";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours
    ? `${String(hours)} hr ${String(minutes)} min`
    : `${String(minutes)} min`;
}

export function formatRecordingSize(fileSizeBytes: string): string {
  const bytes = Number(fileSizeBytes);
  if (!isFinite(bytes) || bytes < 0) return "Unavailable";
  return `${String(Math.round(bytes / 104_857.6) / 10)} MB`;
}
