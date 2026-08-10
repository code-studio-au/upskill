import type { HTMLAttributes } from "react";
import classes from "./Badge.module.css";

interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  color?: string;
  variant?: "light" | "outline";
  w?: "fit-content";
}

export function Badge({
  className,
  color = "indigo",
  variant = "light",
  w,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={`${classes.badge ?? ""} ${className ?? ""}`}
      data-color={color}
      data-variant={variant}
      data-width={w}
    />
  );
}
