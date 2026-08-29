import { useId, useRef, useState } from "react";
import { Button, Group, Paper, Stack, Title } from "#/features/shared/mantine";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import type { BulkPricing } from "#/features/catalog/catalog.schema";
import classes from "./AdminCourseBulkPricingEditor.module.css";

function numericValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AdminCourseBulkPricingEditor({
  bulkPricing,
  editable,
  individualPriceCents,
  onChange,
}: {
  bulkPricing: BulkPricing;
  editable: boolean;
  individualPriceCents: number;
  onChange: (pricing: BulkPricing) => void;
}) {
  const tierKeyPrefix = useId();
  const nextTierKey = useRef(bulkPricing.tiers.length);
  const [tierKeys, setTierKeys] = useState(() =>
    bulkPricing.tiers.map((_, index) => `${tierKeyPrefix}-${String(index)}`),
  );

  function createTierKey(): string {
    const key = `${tierKeyPrefix}-${String(nextTierKey.current)}`;
    nextTierKey.current += 1;
    return key;
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3} size="h4">
            Bulk pricing
          </Title>
          <MantineCheckbox
            label="Allow bulk purchases"
            checked={bulkPricing.enabled}
            disabled={!editable}
            onChange={(checked) => {
              if (checked && bulkPricing.tiers.length === 0)
                setTierKeys([createTierKey()]);
              onChange({
                enabled: checked,
                tiers:
                  checked && bulkPricing.tiers.length === 0
                    ? [
                        {
                          minimumQuantity: 5,
                          unitPriceCents: Math.max(
                            1,
                            Math.floor(individualPriceCents * 0.9),
                          ),
                        },
                      ]
                    : bulkPricing.tiers,
              });
            }}
          />
        </Group>
        {bulkPricing.enabled ? (
          <Stack gap="sm">
            {bulkPricing.tiers.map((tier, index) => (
              <div className={classes.tier} key={tierKeys[index]}>
                <MantineTextInput
                  label="Minimum seats"
                  type="number"
                  inputMode="numeric"
                  min={2}
                  value={String(tier.minimumQuantity)}
                  disabled={!editable}
                  onChange={(event) => {
                    const value = numericValue(event.currentTarget.value);
                    onChange({
                      ...bulkPricing,
                      tiers: bulkPricing.tiers.map(
                        (candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, minimumQuantity: value }
                            : candidate,
                      ),
                    });
                  }}
                />
                <MantineTextInput
                  label="Price per seat (AUD)"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  value={String(tier.unitPriceCents / 100)}
                  disabled={!editable}
                  onChange={(event) => {
                    const value = Math.round(
                      numericValue(event.currentTarget.value) * 100,
                    );
                    onChange({
                      ...bulkPricing,
                      tiers: bulkPricing.tiers.map(
                        (candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, unitPriceCents: value }
                            : candidate,
                      ),
                    });
                  }}
                />
                {editable ? (
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                      setTierKeys((current) =>
                        current.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      );
                      onChange({
                        ...bulkPricing,
                        tiers: bulkPricing.tiers.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      });
                    }}
                  >
                    Remove tier
                  </Button>
                ) : null}
              </div>
            ))}
            {editable && bulkPricing.tiers.length < 20 ? (
              <Button
                type="button"
                variant="light"
                onClick={() => {
                  const last = bulkPricing.tiers.at(-1);
                  const tierKey = createTierKey();
                  setTierKeys((current) => [...current, tierKey]);
                  onChange({
                    ...bulkPricing,
                    tiers: [
                      ...bulkPricing.tiers,
                      {
                        minimumQuantity: (last?.minimumQuantity ?? 1) + 5,
                        unitPriceCents: Math.max(
                          1,
                          Math.floor(
                            (last?.unitPriceCents ?? individualPriceCents) *
                              0.9,
                          ),
                        ),
                      },
                    ],
                  });
                }}
              >
                Add pricing tier
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
