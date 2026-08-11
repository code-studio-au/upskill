import "@tanstack/react-start/server-only";

import { randomInt } from "node:crypto";

const CODE_PATTERN = /^[A-Z0-9]{8,80}$/;
const LOOKUP_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LOOKUP_ID_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/;
const ACCESS_CODE_LOOKUP_ID_LENGTH = 10;

export function formatAccessCode(value: string): string | null {
  const formatted = value
    .trim()
    .toLocaleUpperCase("en-AU")
    .replaceAll(/[^A-Z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  return normalizeAccessCode(formatted) ? formatted : null;
}

export function normalizeAccessCode(value: string): string | null {
  const normalized = value
    .trim()
    .toLocaleUpperCase("en-AU")
    .replaceAll(/[\s-]/g, "");
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function createAccessCodeLookupId(): string {
  return Array.from(
    { length: ACCESS_CODE_LOOKUP_ID_LENGTH },
    () => LOOKUP_ID_ALPHABET[randomInt(LOOKUP_ID_ALPHABET.length)],
  ).join("");
}

export function issueAccessCode(
  value: string,
  lookupId = createAccessCodeLookupId(),
): { accessCode: string; lookupId: string } | null {
  const base = formatAccessCode(value);
  const normalizedLookupId = lookupId.toLocaleUpperCase("en-AU");
  if (!base || !LOOKUP_ID_PATTERN.test(normalizedLookupId)) return null;
  const accessCode = `${base}-${normalizedLookupId}`;
  return normalizeAccessCode(accessCode)
    ? { accessCode, lookupId: normalizedLookupId }
    : null;
}

export function extractAccessCodeLookupId(value: string): string | null {
  const normalized = normalizeAccessCode(value);
  if (!normalized) return null;
  const lookupId = normalized.slice(-ACCESS_CODE_LOOKUP_ID_LENGTH);
  return LOOKUP_ID_PATTERN.test(lookupId) ? lookupId : null;
}
