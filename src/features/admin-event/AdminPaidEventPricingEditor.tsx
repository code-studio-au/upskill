import { Group, Paper, Stack, Title } from "#/features/shared/mantine";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import type { BulkPricing } from "#/features/catalog/catalog.schema";
import { AdminCourseBulkPricingEditor } from "#/features/admin-course/AdminCourseBulkPricingEditor";
import classes from "./AdminEventOccurrenceEditor.module.css";

function numericValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AdminPaidEventPricingEditor({
  priceCents,
  salePriceCents,
  bulkPricing,
  onPriceChange,
  onSalePriceChange,
  onBulkPricingChange,
}: {
  priceCents: number | null;
  salePriceCents: number | null;
  bulkPricing: BulkPricing;
  onPriceChange: (priceCents: number) => void;
  onSalePriceChange: (salePriceCents: number | null) => void;
  onBulkPricingChange: (bulkPricing: BulkPricing) => void;
}) {
  const originalPrice = priceCents ?? 0;
  const discount =
    salePriceCents === null || originalPrice === 0
      ? 10
      : Math.round((1 - salePriceCents / originalPrice) * 10_000) / 100;
  return (
    <Stack gap="md">
      <Paper withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3} size="h4">
              Individual pricing
            </Title>
            <MantineCheckbox
              label="On sale"
              checked={salePriceCents !== null}
              onChange={(checked) => {
                onSalePriceChange(
                  checked ? Math.max(1, Math.round(originalPrice * 0.9)) : null,
                );
              }}
            />
          </Group>
          <div className={classes.threeColumnGrid}>
            <MantineTextInput
              label="Original price (AUD)"
              type="number"
              inputMode="decimal"
              min={0.01}
              step="0.01"
              value={String(originalPrice / 100)}
              onChange={(event) => {
                const nextPrice = Math.round(
                  numericValue(event.currentTarget.value) * 100,
                );
                onPriceChange(nextPrice);
                if (salePriceCents !== null)
                  onSalePriceChange(
                    Math.max(1, Math.round(nextPrice * (1 - discount / 100))),
                  );
              }}
            />
            <MantineTextInput
              label="Sale discount (%)"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={99.99}
              step="0.01"
              value={salePriceCents === null ? "" : String(discount)}
              disabled={salePriceCents === null}
              onChange={(event) => {
                const nextDiscount = Math.min(
                  99.99,
                  Math.max(0.01, numericValue(event.currentTarget.value)),
                );
                onSalePriceChange(
                  Math.max(
                    1,
                    Math.round(originalPrice * (1 - nextDiscount / 100)),
                  ),
                );
              }}
            />
            <MantineTextInput
              label="Sale price (AUD)"
              value={
                salePriceCents === null
                  ? "Not on sale"
                  : (salePriceCents / 100).toFixed(2)
              }
              readOnly
            />
          </div>
        </Stack>
      </Paper>
      <AdminCourseBulkPricingEditor
        bulkPricing={bulkPricing}
        editable
        individualPriceCents={salePriceCents ?? originalPrice}
        onChange={onBulkPricingChange}
      />
    </Stack>
  );
}
