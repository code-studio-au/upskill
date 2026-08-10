const compressibleTypes = [
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/rss+xml",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
  "text/",
];

function encodingQuality(header, encoding) {
  let wildcard = null;
  for (const entry of String(header ?? "").split(",")) {
    const [rawName, ...parameters] = entry.trim().toLowerCase().split(";");
    if (!rawName) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/u.exec(
        parameter,
      );
      if (match) quality = Number(match[1]);
    }
    if (rawName === encoding) return quality;
    if (rawName === "*") wildcard = quality;
  }
  return wildcard ?? 0;
}

export function selectContentEncoding(
  acceptEncoding,
  { brotliAvailable = false, gzipAvailable = false, secure = false } = {},
) {
  const brotliQuality =
    secure && brotliAvailable ? encodingQuality(acceptEncoding, "br") : 0;
  const gzipQuality = gzipAvailable
    ? encodingQuality(acceptEncoding, "gzip")
    : 0;
  if (brotliQuality > 0 && brotliQuality >= gzipQuality) return "br";
  if (gzipQuality > 0) return "gzip";
  return null;
}

export function isCompressibleContentType(contentType) {
  const normalized = String(contentType ?? "")
    .trim()
    .toLowerCase();
  return compressibleTypes.some((type) => normalized.startsWith(type));
}

export function appendVary(current, field) {
  if (!current) return field;
  if (current.trim() === "*") return "*";
  const fields = current
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!fields.some((value) => value.toLowerCase() === field.toLowerCase()))
    fields.push(field);
  return fields.join(", ");
}
