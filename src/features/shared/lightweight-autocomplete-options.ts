export interface LightweightAutocompleteOption {
  value: string;
  label: string;
  description?: string | undefined;
}

export function filterAutocompleteOptions(
  options: ReadonlyArray<LightweightAutocompleteOption>,
  query: string,
  limit: number,
) {
  const normalized = query.trim().toLocaleLowerCase("en-AU");
  return options
    .filter((option) =>
      `${option.label} ${option.description ?? ""} ${option.value}`
        .toLocaleLowerCase("en-AU")
        .includes(normalized),
    )
    .slice(0, limit);
}
