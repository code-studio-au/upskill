import classes from "./LoadingSpinner.module.css";

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <span
      className={classes.status}
      role={label ? "status" : undefined}
      aria-label={label}
    >
      <span className={classes.spinner} aria-hidden="true" />
    </span>
  );
}
