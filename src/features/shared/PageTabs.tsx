import classes from "./PageTabs.module.css";

export interface PageTab<Value extends string> {
  value: Value;
  label: string;
}

export function PageTabs<Value extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: Value;
  tabs: Array<PageTab<Value>>;
  onChange: (value: Value) => void;
}) {
  return (
    <div className={classes.tabs} role="group" aria-label={label}>
      {tabs.map((tab) => (
        <button
          className={classes.tab}
          data-active={tab.value === value || undefined}
          aria-pressed={tab.value === value}
          key={tab.value}
          onClick={() => {
            onChange(tab.value);
          }}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
