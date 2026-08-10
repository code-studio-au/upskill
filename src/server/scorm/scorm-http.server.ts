import "@tanstack/react-start/server-only";

import { getServerEnv } from "#/server/env.server";
import { applySecurityHeaders } from "#/server/http/security-headers";

const DEVELOPMENT_COOKIE = "upskill_scorm_session";
const SECURE_COOKIE = "__Host-upskill_scorm_session";

export function isLearningOrigin(request: Request): boolean {
  return (
    new URL(request.url).origin ===
    new URL(getServerEnv().LEARNING_ORIGIN).origin
  );
}

function cookieName(): string {
  const { APP_ENV } = getServerEnv();
  return APP_ENV === "production" || APP_ENV === "staging"
    ? SECURE_COOKIE
    : DEVELOPMENT_COOKIE;
}

export function readScormSessionCookie(request: Request): string | null {
  const name = cookieName();
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name)
      return pair.slice(separator + 1).trim();
  }
  return null;
}

export function scormSessionCookie(token: string): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${cookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function scormResponseHeaders(
  request: Request,
  initial?: HeadersInit,
): Headers {
  const headers = new Headers(initial);
  applySecurityHeaders(headers, "scorm-learning-origin", request);
  return headers;
}
