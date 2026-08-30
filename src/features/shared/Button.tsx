import {
  createElement,
  type ComponentPropsWithoutRef,
  type ElementType,
  type MouseEvent,
  type ReactNode,
} from "react";
import classes from "./Button.module.css";

type ButtonSize = "compact-sm" | "compact-xs" | "lg" | "sm" | "xs";
type ButtonVariant = "default" | "light" | "outline" | "subtle";

interface ButtonOwnProps<Component extends ElementType> {
  children?: ReactNode;
  className?: string | undefined;
  color?: "blue" | "gray" | "green" | "indigo" | "red";
  component?: Component;
  disabled?: boolean;
  fullWidth?: boolean;
  leftSection?: ReactNode;
  loading?: boolean;
  mt?: "lg" | "md" | "sm" | "xl";
  px?: 0;
  rightSection?: ReactNode;
  radius?: "sm";
  size?: ButtonSize;
  variant?: ButtonVariant;
  w?: "fit-content";
}

type ButtonProps<Component extends ElementType> = ButtonOwnProps<Component> &
  Omit<ComponentPropsWithoutRef<Component>, keyof ButtonOwnProps<Component>>;

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function Button<Component extends ElementType = "button">({
  children,
  className,
  color = "indigo",
  component,
  disabled,
  fullWidth,
  leftSection,
  loading,
  mt,
  onClick,
  px,
  radius,
  rightSection,
  size,
  type,
  variant,
  w,
  ...props
}: ButtonProps<Component>) {
  const element = component ?? "button";
  const unavailable = Boolean(disabled || loading);
  const clickHandler: unknown = onClick;
  const preventUnavailable = (event: MouseEvent<HTMLElement>) => {
    if (unavailable) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (typeof clickHandler === "function")
      (clickHandler as (clickEvent: MouseEvent<HTMLElement>) => void)(event);
  };
  const elementProps: Record<string, unknown> = {
    ...props,
    "aria-busy": loading || undefined,
    "aria-disabled":
      element === "button" ? undefined : unavailable || undefined,
    className: classNames(
      classes.root,
      classes[variant ?? "filled"],
      classes[color],
      size && classes[size],
      fullWidth && classes.fullWidth,
      w && classes.fitContent,
      px === 0 && classes.paddingX0,
      radius && classes.radiusSm,
      mt && classes[`margin-${mt}`],
      loading && classes.loading,
      className,
    ),
    onClick: preventUnavailable,
  };
  if (element === "button") {
    elementProps.disabled = unavailable;
    elementProps.type = type ?? "button";
  }
  return createElement(
    element,
    elementProps,
    loading ? <span className={classes.loader} aria-hidden="true" /> : null,
    <span className={classes.label}>
      {leftSection}
      {children}
      {rightSection}
    </span>,
  );
}
