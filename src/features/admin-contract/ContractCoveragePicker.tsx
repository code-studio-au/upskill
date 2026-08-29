import { useState } from "react";
import { LightweightAutocomplete } from "#/features/shared/LightweightAutocomplete";
import { Button, Group, Paper, Stack, Text } from "#/features/shared/mantine";
import classes from "./AdminEnterpriseContractManager.module.css";

export interface ContractCoverageOption {
  id: string;
  title: string;
  description: string;
}

export function ContractCoveragePicker({
  label,
  description,
  emptyMessage,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  description: string;
  emptyMessage: string;
  options: ReadonlyArray<ContractCoverageOption>;
  selectedIds: Array<string>;
  onChange: (ids: Array<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const optionById = new Map(options.map((option) => [option.id, option]));
  const selectedIdSet = new Set(selectedIds);
  const selected = selectedIds.flatMap((id) => {
    const option = optionById.get(id);
    return option ? [option] : [];
  });
  const available = options.filter((option) => !selectedIdSet.has(option.id));

  return (
    <Stack gap="sm">
      <div>
        <Text fw={600}>{label}</Text>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </div>
      <LightweightAutocomplete
        type="search"
        label={`Add ${label.toLocaleLowerCase("en-AU")}`}
        placeholder={
          available.length ? "Search available offerings" : "All added"
        }
        value={query}
        disabled={available.length === 0}
        options={available.map((option) => ({
          value: option.id,
          label: option.title,
          description: option.description,
        }))}
        limit={8}
        onChange={setQuery}
        onSelect={(option) => {
          onChange([...selectedIds, option.value]);
          setQuery("");
        }}
      />
      {selected.length ? (
        <div className={classes.selectionList} aria-label={`${label} selected`}>
          {selected.map((option) => (
            <Paper withBorder radius="md" p="sm" key={option.id}>
              <Group justify="space-between" align="center" wrap="nowrap">
                <div className={classes.selectionIdentity}>
                  <Text fw={600} size="sm">
                    {option.title}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {option.description}
                  </Text>
                </div>
                <Button
                  type="button"
                  size="compact-xs"
                  color="red"
                  variant="subtle"
                  onClick={() => {
                    onChange(selectedIds.filter((id) => id !== option.id));
                  }}
                >
                  Remove
                </Button>
              </Group>
            </Paper>
          ))}
        </div>
      ) : (
        <div className={classes.selectionEmpty}>{emptyMessage}</div>
      )}
    </Stack>
  );
}
