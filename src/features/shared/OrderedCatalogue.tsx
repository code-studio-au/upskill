import type { ReactNode } from "react";
import { Alert, Group, Paper } from "./mantine";
import classes from "./OrderedCatalogue.module.css";

interface OrderedCatalogueItem {
  id: string;
  label: string;
  title: ReactNode;
  status: ReactNode;
}

export function OrderedCatalogue({
  empty,
  items,
  onMove,
}: {
  empty: string;
  items: ReadonlyArray<OrderedCatalogueItem>;
  onMove: (id: string, direction: "down" | "up") => void;
}) {
  if (items.length === 0) return <Alert>{empty}</Alert>;
  return (
    <div className={classes.grid}>
      {items.map((item, index) => (
        <Paper
          component="article"
          key={item.id}
          withBorder
          radius="lg"
          p="md"
          className={classes.card}
        >
          <Group justify="space-between" align="start" wrap="nowrap">
            {item.title}
            {item.status}
          </Group>
          <div className={classes.order}>
            <button
              type="button"
              aria-label={`Move ${item.label} up`}
              disabled={index === 0}
              onClick={() => {
                onMove(item.id, "up");
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${item.label} down`}
              disabled={index === items.length - 1}
              onClick={() => {
                onMove(item.id, "down");
              }}
            >
              ↓
            </button>
          </div>
        </Paper>
      ))}
    </div>
  );
}
