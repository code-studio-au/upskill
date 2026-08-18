export interface FixedWindowRateLimitEntry {
  count: number;
  resetAt: number;
}

export function forwardedClientAddress(headers: Pick<Headers, "get">) {
  const forwarded =
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((address) => address.trim())
      .filter(Boolean) ?? [];

  // Production has two trusted forwarding hops: ALB, then nginx. Nginx
  // appends the ALB address, so the actual client is second from the right.
  return forwarded.at(-2) ?? forwarded.at(-1) ?? "unknown";
}

export function consumeFixedWindowRateLimit(
  entries: Map<string, FixedWindowRateLimitEntry>,
  key: string,
  now: number,
  options: {
    maximumEntries: number;
    maximumRequests: number;
    windowMs: number;
  },
) {
  if (entries.size >= options.maximumEntries)
    for (const [candidateKey, entry] of entries)
      if (entry.resetAt <= now) entries.delete(candidateKey);

  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && entries.size >= options.maximumEntries) return false;
    entries.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return true;
  }

  current.count += 1;
  return current.count <= options.maximumRequests;
}
