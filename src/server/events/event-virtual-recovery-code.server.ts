import "@tanstack/react-start/server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "#/server/env.server";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

class EventVirtualRecoveryCodeProtectionError extends Error {
  constructor() {
    super("Event virtual recovery-code protection failed");
    this.name = "EventVirtualRecoveryCodeProtectionError";
  }
}

function encryptionKey(): Buffer {
  const key = Buffer.from(
    getServerEnv().ACCESS_CODE_ENCRYPTION_KEY,
    "base64url",
  );
  if (key.length !== KEY_BYTES)
    throw new EventVirtualRecoveryCodeProtectionError();
  return key;
}

function additionalData(challengeId: string): Buffer {
  return Buffer.from(
    `upskill/event-virtual-recovery/${ENVELOPE_VERSION}\0${challengeId}`,
    "utf8",
  );
}

export function encryptEventVirtualRecoveryCode(
  challengeId: string,
  code: string,
): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), nonce, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(additionalData(challengeId));
  const ciphertext = Buffer.concat([
    cipher.update(code, "utf8"),
    cipher.final(),
  ]);
  return [
    ENVELOPE_VERSION,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptEventVirtualRecoveryCode(
  challengeId: string,
  encryptedCode: string,
): string {
  try {
    const [version, encodedNonce, encodedCiphertext, encodedAuthenticationTag] =
      encryptedCode.split(".");
    if (
      version !== ENVELOPE_VERSION ||
      !encodedNonce ||
      !encodedCiphertext ||
      !encodedAuthenticationTag
    )
      throw new EventVirtualRecoveryCodeProtectionError();
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
      throw new EventVirtualRecoveryCodeProtectionError();
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAAD(additionalData(challengeId));
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof EventVirtualRecoveryCodeProtectionError) throw error;
    throw new EventVirtualRecoveryCodeProtectionError();
  }
}
