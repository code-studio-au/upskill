const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/u;

export function normalizeInternationalPhone(value: string): string | null {
  const normalized = value.trim().replace(/[\s().-]/gu, "");
  return E164_PHONE_PATTERN.test(normalized) ? normalized : null;
}
