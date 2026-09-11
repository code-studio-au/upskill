const BYTE_RANGE_PATTERN = /^bytes=\d*-\d*$/u;

export type ByteRange =
  | { status: "none" }
  | { status: "valid"; value: string }
  | { status: "invalid" };

export function parseByteRange(range: string | null): ByteRange {
  if (!range) return { status: "none" };
  if (range.length > 100 || !BYTE_RANGE_PATTERN.test(range))
    return { status: "invalid" };
  const [start, end] = range.slice("bytes=".length).split("-");
  if (!start && !end) return { status: "invalid" };
  if (start && end && BigInt(start) > BigInt(end)) return { status: "invalid" };
  return { status: "valid", value: range };
}

export function boundByteRange(range: string, maximumBytes: number): string {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
    throw new RangeError("Maximum byte range size must be a positive integer");
  const parsed = parseByteRange(range);
  if (parsed.status !== "valid") throw new RangeError("Byte range is invalid");
  const [startValue, endValue] = parsed.value.slice("bytes=".length).split("-");
  const maximumSpan = BigInt(maximumBytes);
  if (!startValue)
    return `bytes=-${String(
      endValue
        ? BigInt(endValue) < maximumSpan
          ? BigInt(endValue)
          : maximumSpan
        : maximumSpan,
    )}`;
  const start = BigInt(startValue);
  const maximumEnd = start + maximumSpan - 1n;
  const end = endValue ? BigInt(endValue) : maximumEnd;
  return `bytes=${String(start)}-${String(end < maximumEnd ? end : maximumEnd)}`;
}
