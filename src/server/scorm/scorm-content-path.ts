const RANGE_PATTERN = /^bytes=\d*-\d*$/u;

export function parseScormContentPath(path: string | undefined): string | null {
  if (!path || path.length > 2_048 || path.includes("\\")) return null;
  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\0"),
    )
  )
    return null;
  return segments.join("/");
}

export function parseScormRange(range: string | null): string | undefined {
  if (!range || range.length > 100 || !RANGE_PATTERN.test(range))
    return undefined;
  const [start, end] = range.slice("bytes=".length).split("-");
  if (!start && !end) return undefined;
  return range;
}

export function resolveScormContentType(
  path: string,
  storedContentType: string | undefined,
): string {
  if (storedContentType && storedContentType !== "application/octet-stream")
    return storedContentType;
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    {
      ".aac": "audio/aac",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".oga": "audio/ogg",
      ".ogg": "audio/ogg",
      ".ogv": "video/ogg",
      ".vtt": "text/vtt; charset=utf-8",
      ".webm": "video/webm",
    }[extension] ?? "application/octet-stream"
  );
}
