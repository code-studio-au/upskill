const recordingSizeFormatter = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
});

export function formatRecordingDuration(durationNanoseconds: string): string {
  try {
    const totalMinutes = Number(BigInt(durationNanoseconds) / 60_000_000_000n);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours
      ? `${String(hours)} hr ${String(minutes)} min`
      : `${String(minutes)} min`;
  } catch {
    return "Unavailable";
  }
}

export function formatRecordingSize(fileSizeBytes: string): string {
  const bytes = Number(fileSizeBytes);
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  const megabytes = bytes / (1024 * 1024);
  return `${recordingSizeFormatter.format(megabytes)} MB`;
}
