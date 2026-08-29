import { MantineProgress } from "#/features/shared/MantineProgress";
import classes from "./SectionedProgress.module.css";
import cardClasses from "./LearnerProgressCard.module.css";

interface ProgressSection {
  id: string;
  title: string;
  completedItems: number;
  totalItems: number;
}

export function SectionedProgress({
  label,
  sections,
  title,
}: {
  label: string;
  sections: Array<ProgressSection>;
  title: string;
}) {
  const visible = sections.filter((section) => section.totalItems > 0);
  const completed = visible.reduce(
    (total, section) => total + section.completedItems,
    0,
  );
  const items = visible.reduce(
    (total, section) => total + section.totalItems,
    0,
  );
  const overall = items === 0 ? 0 : Math.round((completed / items) * 100);
  return (
    <div>
      <div className={cardClasses.summary}>
        <span className={cardClasses.progressTitle}>{title}</span>
        <span className={cardClasses.count}>
          {items === 0
            ? "Not started"
            : `${String(completed)}/${String(items)}`}
        </span>
      </div>
      {visible.length === 0 ? (
        <MantineProgress
          value={0}
          color="green"
          aria-label={`${label}: no tasks`}
        />
      ) : (
        <div
          className={classes.track}
          role="group"
          aria-label={`${label}: ${String(overall)}% complete`}
        >
          {visible.map((section) => {
            const value = Math.round(
              (section.completedItems / section.totalItems) * 100,
            );
            return (
              <div className={classes.segment} key={section.id}>
                <span className={classes.label} title={section.title}>
                  {section.title}
                </span>
                <MantineProgress
                  value={value}
                  color="green"
                  aria-label={`${section.title}: ${String(section.completedItems)} of ${String(section.totalItems)} complete`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
