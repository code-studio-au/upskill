import { Text } from "#/features/shared/mantine";
import classes from "./MantineCheckbox.module.css";

export function MantineCheckbox({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`${classes.label ?? ""} ${disabled ? (classes.disabled ?? "") : ""}`}
    >
      <input
        className={classes.input}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
      />
      <Text component="span" size="sm">
        {label}
      </Text>
    </label>
  );
}
