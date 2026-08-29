export function normalizeContractIdentityValue(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

export function mergeContractIdentityValues(
  values: ReadonlyArray<string>,
  pendingValue: string,
): Array<string> {
  const identities = new Set<string>();
  for (const value of [...values, pendingValue]) {
    const normalized = normalizeContractIdentityValue(value);
    if (normalized) identities.add(normalized);
  }
  return [...identities];
}
