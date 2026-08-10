import "@tanstack/react-start/server-only";

const CODE_PATTERN = /^[A-Z0-9]{8,64}$/;

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
