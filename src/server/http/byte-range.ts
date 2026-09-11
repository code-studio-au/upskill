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
