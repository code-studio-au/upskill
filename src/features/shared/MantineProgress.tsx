import classes from "./MantineProgress.module.css";

export function MantineProgress({
  "aria-label": ariaLabel,
  color = "indigo",
  value,
}: {
  "aria-label": string;
  color?: "green" | "indigo";
  value: number;
}) {
  return (
    <progress
      className={classes.progress}
      value={Math.min(100, Math.max(0, value))}
      max={100}
      aria-label={ariaLabel}
      data-color={color}
    />
  );
}
