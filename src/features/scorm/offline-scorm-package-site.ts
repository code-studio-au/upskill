import { getDomain, parse } from "tldts";

export function parseExactOfflineScormOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new TypeError("Expected an exact origin");
  return url;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

export function isPotentiallyTrustworthyOfflineScormOrigin(
  origin: URL,
): boolean {
  return origin.protocol === "https:" || isLoopbackHostname(origin.hostname);
}

function offlineScormSchemefulSite(origin: URL): string {
  const domain = getDomain(origin.hostname, {
    allowPrivateDomains: true,
    detectIp: true,
    validateHostname: true,
  });
  return `${origin.protocol}//${domain ?? origin.hostname}`;
}

export function assertOfflineScormPackageOriginIsolation(input: {
  applicationOrigin: string;
  learningOrigin: string;
  packageOrigin: string;
}): void {
  const applicationOrigin = parseExactOfflineScormOrigin(
    input.applicationOrigin,
  );
  const learningOrigin = parseExactOfflineScormOrigin(input.learningOrigin);
  const packageOrigin = parseExactOfflineScormOrigin(input.packageOrigin);
  if (!isPotentiallyTrustworthyOfflineScormOrigin(packageOrigin))
    throw new TypeError("The package origin must use HTTPS outside loopback");
  const packageSite = offlineScormSchemefulSite(packageOrigin);
  if (
    packageOrigin.origin === applicationOrigin.origin ||
    packageOrigin.origin === learningOrigin.origin ||
    packageSite === offlineScormSchemefulSite(applicationOrigin) ||
    packageSite === offlineScormSchemefulSite(learningOrigin)
  )
    throw new TypeError(
      "The package origin must use a distinct registrable site",
    );
}

function parseOfflineScormPrivateSiteSuffix(value: string): string {
  if (
    value.length < 3 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      value,
    )
  )
    throw new TypeError(
      "The offline SCORM package-site suffix must be canonical lowercase DNS",
    );
  const probeHostname = `probe.${value}`;
  const parsed = parse(probeHostname, { allowPrivateDomains: true });
  if (
    !parsed.isPrivate ||
    parsed.publicSuffix !== value ||
    parsed.domain !== probeHostname
  )
    throw new TypeError(
      "The offline SCORM package-site suffix must be registered in the private Public Suffix List",
    );
  return value;
}

export function parseOfflineScormPackageSiteSuffix(
  value: string,
  environment: "development" | "test" | "staging" | "production",
): string {
  if (
    (environment === "development" || environment === "test") &&
    value === "localhost"
  )
    return value;
  return parseOfflineScormPrivateSiteSuffix(value);
}
