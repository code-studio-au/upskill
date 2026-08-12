import { Button } from "#/features/shared/mantine";
import classes from "./RemovableFilterChip.module.css";

interface RemovableFilterChipProps {
  label: string;
  onRemove: () => void;
  value: string;
}

export function RemovableFilterChip({
  label,
  onRemove,
  value,
}: RemovableFilterChipProps) {
  return (
    <Button
      type="button"
      variant="light"
      size="compact-sm"
      radius="sm"
      className={classes.chip}
      aria-label={`Clear ${label.toLowerCase()} filter: ${value}`}
      onClick={onRemove}
    >
      <span className={classes.label}>
        {label}: {value}
      </span>
      <span className={classes.remove} aria-hidden="true">
        ×
      </span>
    </Button>
  );
}
