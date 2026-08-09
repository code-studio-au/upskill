import "@tanstack/react-start/server-only";

import { createHmac } from "node:crypto";

const CODE_PATTERN = /^[A-Z0-9]{12,64}$/;
const HMAC_CONTEXT = "upskill/access-code/v1\0";

export function normalizeAccessCode(value: string): string | null {
  const normalized = value
    .trim()
    .toLocaleUpperCase("en-AU")
    .replaceAll(/[\s-]/g, "");
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

export function digestAccessCode(value: string, pepper: string): string | null {
  const normalized = normalizeAccessCode(value);
  if (!normalized) return null;

  return createHmac("sha256", pepper)
    .update(HMAC_CONTEXT)
    .update(normalized)
    .digest("hex");
}
