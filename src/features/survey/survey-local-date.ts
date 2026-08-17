const displayDatePattern = /^(\d{2})\/(\d{2})\/(\d{4})$/u;
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatSurveyLocalDate(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const match = isoDatePattern.exec(value);
  if (!match) return "";
  const [, year, month, day] = match;
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

export function parseSurveyLocalDate(value: string): string | null {
  if (!value.trim()) return "";
  const match = displayDatePattern.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  if (!year || !month || !day) return null;
  if (!isValidDate(Number(year), Number(month), Number(day))) return null;
  return `${year}-${month}-${day}`;
}

export function maskSurveyLocalDate(value: string): string {
  const digits = value.replaceAll(/\D/gu, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
    .filter(Boolean)
    .join("/");
}
