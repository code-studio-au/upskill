const recordingSizeFormatter = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
});

export function formatRecordingDuration(durationNanoseconds: string): string {
  try {
    const totalMinutes = BigInt(durationNanoseconds) / 60_000_000_000n;
    const hours = totalMinutes / 60n;
    const minutes = totalMinutes % 60n;
    return hours
      ? `${String(hours)} hr ${String(minutes)} min`
      : `${String(minutes)} min`;
  } catch {
    return "Unavailable";
  }
}

export function formatRecordingSize(fileSizeBytes: string): string {
  const bytes = Number(fileSizeBytes);
  if (!isFinite(bytes) || bytes < 0) return "Unavailable";
  return `${recordingSizeFormatter.format(bytes / (1024 * 1024))} MB`;
}
