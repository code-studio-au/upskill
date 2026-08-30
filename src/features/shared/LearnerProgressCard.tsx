import type { ReactNode } from "react";
import { SectionedProgress } from "./SectionedProgress";
import classes from "./LearnerProgressCard.module.css";

interface ProgressSection {
  id: string;
  title: string;
  completedItems: number;
  totalItems: number;
}

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function LearnerProgressCard({
  actions,
  children,
  className,
  progress,
  progressTitle,
  status,
  subtitle,
  title,
}: {
  actions: ReactNode;
  children?: ReactNode;
  className: string | undefined;
  progress: Array<ProgressSection> | null;
  progressTitle: string;
  status: ReactNode;
  subtitle: ReactNode;
  title: string;
}) {
  return (
    <article className={classNames(classes.card, className)}>
      <div className={classes.content}>
        <div className={classes.header}>
          <div>
            <h3 className={classes.title}>{title}</h3>
            <p className={classes.subtitle}>{subtitle}</p>
          </div>
          {status}
        </div>
        {children}
        {progress ? (
          <SectionedProgress
            title={progressTitle}
            label={`${title} ${progressTitle.toLowerCase()}`}
            sections={progress}
          />
        ) : null}
        {actions}
      </div>
    </article>
  );
}
