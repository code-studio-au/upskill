import {
  createElement,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import classes from "./ui.module.css";

type Space = "xs" | "sm" | "md" | "lg" | "xl";
type AlertColor = "blue" | "gray" | "green" | "indigo" | "orange" | "red";

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  color?: AlertColor;
  title?: ReactNode;
}

export function Alert({
  children,
  className,
  color = "blue",
  title,
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      className={classNames(
        classes.alert,
        classes[`alert-${color}`],
        className,
      )}
    >
      {title ? <div className={classes.alertTitle}>{title}</div> : null}
      <div>{children}</div>
    </div>
  );
}

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Space | 4;
  h?: "100%";
}

interface GroupProps extends HTMLAttributes<HTMLDivElement> {
  align?: "baseline" | "center" | "end" | "flex-start" | "start";
  gap?: "xs" | "sm" | "md";
  grow?: boolean;
  justify?: "end" | "flex-end" | "space-between";
  mb?: 4;
  mt?: "xs";
  wrap?: "nowrap" | "wrap";
}

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  fluid?: boolean;
  py?: "xl" | { base: 64; sm: 96 };
  size?: "sm" | "lg" | "xl";
}

export function Container({
  children,
  className,
  fluid,
  py,
  size,
  ...props
}: ContainerProps) {
  return (
    <div
      {...props}
      className={classNames(
        classes.container,
        fluid ? classes.containerFluid : classes[`container-${size ?? "md"}`],
        py === "xl"
          ? classes.containerPaddingYl
          : py
            ? classes.containerPaddingResponsive
            : undefined,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Group({
  align = "center",
  children,
  className,
  gap = "md",
  grow,
  justify,
  mb,
  mt,
  wrap = "wrap",
  ...props
}: GroupProps) {
  const normalizedAlign =
    align === "end" || align === "start" ? `flex-${align}` : align;
  const normalizedJustify = justify === "end" ? "flex-end" : justify;

  return (
    <div
      {...props}
      className={classNames(
        classes.group,
        classes[`align-${normalizedAlign}`],
        classes[`group-gap-${gap}`],
        normalizedJustify ? classes[`justify-${normalizedJustify}`] : undefined,
        classes[`wrap-${wrap}`],
        grow && classes.grow,
        mb ? classes.groupMarginBottom4 : undefined,
        mt ? classes.groupMarginTopXs : undefined,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Stack({
  children,
  className,
  gap = "md",
  h,
  ...props
}: StackProps) {
  const gapClass = gap === 4 ? classes.gap4 : classes[gap];
  return (
    <div
      {...props}
      className={classNames(
        classes.stack,
        gapClass,
        Boolean(h) && classes.fullHeight,
        className,
      )}
    >
      {children}
    </div>
  );
}

interface TitleProps extends HTMLAttributes<HTMLHeadingElement> {
  order: 1 | 2 | 3 | 4 | 5 | 6;
  size?: "h3" | "h4";
}

interface TextProps extends HTMLAttributes<HTMLParagraphElement> {
  c?: "dimmed" | "indigo.7" | "red" | "red.7";
  component?: "p" | "span";
  fw?: 500 | 600 | 700 | 800;
  maw?: 720 | 760;
  mt?: 4 | "xs" | "md";
  size?: "xs" | "sm" | "xl";
  td?: "line-through";
  tt?: "capitalize";
}

type PaperPadding = "sm" | "md" | "lg" | "xl";

interface PaperProps extends HTMLAttributes<HTMLDivElement> {
  component?: "article" | "div";
  maw?: 640;
  p?: PaperPadding | { base: "md" | "lg"; sm: "lg" | "xl" };
  radius?: "md" | "lg";
  ref?: Ref<HTMLDivElement>;
  shadow?: "xl";
  withBorder?: boolean;
}

export function Paper({
  children,
  className,
  component = "div",
  maw,
  p,
  radius,
  shadow,
  withBorder,
  ...props
}: PaperProps) {
  const paddingClass =
    typeof p === "object"
      ? classes[`paperPaddingResponsive-${p.base}-${p.sm}`]
      : p
        ? classes[`paperPadding-${p}`]
        : undefined;

  return createElement(
    component,
    {
      ...props,
      className: classNames(
        classes.paper,
        withBorder && classes.paperBorder,
        radius ? classes[`paperRadius-${radius}`] : undefined,
        paddingClass,
        shadow ? classes.paperShadowXl : undefined,
        maw ? classes.paperMax640 : undefined,
        className,
      ),
    } satisfies HTMLAttributes<HTMLDivElement>,
    children,
  );
}

export function Text({
  c,
  children,
  className,
  component = "p",
  fw,
  maw,
  mt,
  size,
  td,
  tt,
  ...props
}: TextProps) {
  return createElement(
    component,
    {
      ...props,
      className: classNames(
        classes.text,
        c ? classes[`color-${c.replace(".", "-")}`] : undefined,
        fw ? classes[`weight-${String(fw)}`] : undefined,
        maw ? classes[`max-${String(maw)}`] : undefined,
        mt ? classes[`margin-${String(mt)}`] : undefined,
        size ? classes[`size-${size}`] : undefined,
        td ? classes.lineThrough : undefined,
        tt ? classes.capitalize : undefined,
        className,
      ),
    } satisfies HTMLAttributes<HTMLParagraphElement>,
    children,
  );
}

export function Title({
  children,
  className,
  order,
  size,
  ...props
}: TitleProps) {
  const level = size ? Number(size.slice(1)) : order;
  return createElement(
    `h${String(order)}`,
    {
      ...props,
      className: classNames(
        classes.title,
        classes[`h${String(level)}`],
        className,
      ),
    } satisfies HTMLAttributes<HTMLHeadingElement>,
    children,
  );
}
