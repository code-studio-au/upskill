import "@tanstack/react-start/server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getServerEnv } from "#/server/env.server";
import { normalizeAccessCode } from "./access-code.server";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class AccessCodeProtectionError extends Error {
  constructor() {
    super("Access-code protection failed");
    this.name = "AccessCodeProtectionError";
  }
}

function encryptionKey(): Buffer {
  const key = Buffer.from(
    getServerEnv().ACCESS_CODE_ENCRYPTION_KEY,
    "base64url",
  );
  if (key.length !== KEY_BYTES) throw new AccessCodeProtectionError();
  return key;
}

function additionalData(accessGrantId: string, lookupId: string): Buffer {
  return Buffer.from(
    `upskill/access-code/${ENVELOPE_VERSION}\0${accessGrantId}\0${lookupId}`,
    "utf8",
  );
}

export function encryptAccessCode(input: {
  accessCode: string;
  accessGrantId: string;
  lookupId: string;
}): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(additionalData(input.accessGrantId, input.lookupId));
  const ciphertext = Buffer.concat([
    cipher.update(input.accessCode, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    authenticationTag.toString("base64url"),
  ].join(".");
}

export function decryptAccessCode(input: {
  accessGrantId: string;
  encryptedAccessCode: string;
  lookupId: string;
}): string {
  try {
    const [version, encodedNonce, encodedCiphertext, encodedAuthenticationTag] =
      input.encryptedAccessCode.split(".");
    if (
      version !== ENVELOPE_VERSION ||
      !encodedNonce ||
      !encodedCiphertext ||
      !encodedAuthenticationTag
    )
      throw new AccessCodeProtectionError();
    const nonce = Buffer.from(encodedNonce, "base64url");
    const ciphertext = Buffer.from(encodedCiphertext, "base64url");
    const authenticationTag = Buffer.from(
      encodedAuthenticationTag,
      "base64url",
    );
    if (
      nonce.length !== NONCE_BYTES ||
      ciphertext.length === 0 ||
      authenticationTag.length !== AUTH_TAG_BYTES
    )
      throw new AccessCodeProtectionError();
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(additionalData(input.accessGrantId, input.lookupId));
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof AccessCodeProtectionError) throw error;
    throw new AccessCodeProtectionError();
  }
}

export function encryptedAccessCodeMatches(input: {
  accessGrantId: string;
  encryptedAccessCode: string;
  lookupId: string;
  submittedAccessCode: string;
}): boolean {
  const stored = normalizeAccessCode(decryptAccessCode(input));
  const submitted = normalizeAccessCode(input.submittedAccessCode);
  if (!stored || !submitted) return false;
  const storedBytes = Buffer.from(stored, "utf8");
  const submittedBytes = Buffer.from(submitted, "utf8");
  return (
    storedBytes.length === submittedBytes.length &&
    timingSafeEqual(storedBytes, submittedBytes)
  );
}
