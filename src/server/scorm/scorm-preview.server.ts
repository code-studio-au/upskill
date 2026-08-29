import "@tanstack/react-start/server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";

const PREVIEW_LIFETIME_SECONDS = 10 * 60;
const DEVELOPMENT_COOKIE = "upskill_scorm_preview";
const SECURE_COOKIE = "__Secure-upskill_scorm_preview";

interface PreviewClaims {
  expiresAt: number;
  nonce: string;
  packageVersionId: string;
}

export interface ScormPreviewPlayer {
  contentPrefix: string;
  launchPath: string;
  packageVersionId: string;
}

function cookieName(): string {
  const { APP_ENV } = getServerEnv();
  return APP_ENV === "production" || APP_ENV === "staging"
    ? SECURE_COOKIE
    : DEVELOPMENT_COOKIE;
}

function signature(payload: string): Buffer {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`upskill-scorm-preview-v1:${payload}`, "utf8")
    .digest();
}

export function issueScormPreviewToken(packageVersionId: string): string {
  const claims: PreviewClaims = {
    expiresAt: Math.floor(Date.now() / 1000) + PREVIEW_LIFETIME_SECONDS,
    nonce: randomBytes(16).toString("base64url"),
    packageVersionId,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyScormPreviewToken(token: string): PreviewClaims | null {
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(
    token.slice(separator + 1),
    "base64url",
  );
  const expectedSignature = signature(payload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  )
    return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claims = value as Partial<PreviewClaims>;
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.packageVersionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,255}$/u.test(claims.packageVersionId) ||
    typeof claims.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{20,24}$/u.test(claims.nonce) ||
    typeof claims.expiresAt !== "number" ||
    !Number.isInteger(claims.expiresAt) ||
    claims.expiresAt <= now ||
    claims.expiresAt > now + PREVIEW_LIFETIME_SECONDS
  )
    return null;
  return claims as PreviewClaims;
}

export function scormPreviewCookie(token: string): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${cookieName()}=${token}`,
    "Path=/api/scorm/previews/",
    `Max-Age=${String(PREVIEW_LIFETIME_SECONDS)}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function readScormPreviewCookie(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === cookieName())
      return pair.slice(separator + 1).trim();
  }
  return null;
}

export async function findScormPreviewPlayer(
  packageVersionId: string,
): Promise<ScormPreviewPlayer | null> {
  const version = await getDatabase()
    .selectFrom("scorm_package_version")
    .select(["id", "contentPrefix", "launchPath", "status"])
    .where("id", "=", packageVersionId)
    .executeTakeFirst();
  if (!version || version.status !== "ready") return null;
  return {
    packageVersionId: version.id,
    contentPrefix: version.contentPrefix,
    launchPath: version.launchPath,
  };
}

export async function authorizedScormPreview(
  request: Request,
  packageVersionId: string,
): Promise<ScormPreviewPlayer | null> {
  const token = readScormPreviewCookie(request);
  const claims = token ? verifyScormPreviewToken(token) : null;
  if (!claims || claims.packageVersionId !== packageVersionId) return null;
  return findScormPreviewPlayer(packageVersionId);
}
