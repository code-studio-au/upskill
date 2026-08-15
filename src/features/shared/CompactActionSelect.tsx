import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";

export interface CompactActionSelectItem<T extends string> {
  value: T;
  label: string;
}

export function CompactActionSelect<T extends string>({
  label,
  ariaLabel,
  items,
  disabled = false,
  loading = false,
  onSelect,
}: {
  label: string;
  ariaLabel: string;
  items: Array<CompactActionSelectItem<T>>;
  disabled?: boolean;
  loading?: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <MantineNativeSelect
      aria-label={ariaLabel}
      value=""
      disabled={disabled || loading}
      data={[
        { value: "", label: loading ? "Saving…" : label, disabled: true },
        ...items.map((item) => ({ value: item.value, label: item.label })),
      ]}
      onChange={(event) => {
        const value = event.currentTarget.value;
        if (value) onSelect(value as T);
      }}
    />
  );
}
