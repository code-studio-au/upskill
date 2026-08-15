export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
