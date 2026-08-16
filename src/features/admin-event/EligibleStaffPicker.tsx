import { useState } from "react";
import { LightweightAutocomplete } from "#/features/shared/LightweightAutocomplete";
import { Button, Group, Paper, Stack, Text } from "#/features/shared/mantine";

interface Person {
  id: string;
  name: string;
  email: string;
}

export function EligibleStaffPicker({
  label,
  candidates,
  people = candidates,
  selectedIds,
  minimumSelected = 0,
  disabled,
  onChange,
}: {
  label: string;
  candidates: Array<Person>;
  people?: Array<Person>;
  selectedIds: Array<string>;
  minimumSelected?: number;
  disabled: boolean;
  onChange: (selectedIds: Array<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const available = candidates.filter(
    (candidate) => !selectedIds.includes(candidate.id),
  );
  const selectedCandidate = available.find(
    (candidate) => candidate.email === query,
  );

  return (
    <Stack gap="xs">
      {selectedIds.length ? (
        selectedIds.map((personId) => {
          const person = people.find((candidate) => candidate.id === personId);
          const eligible = candidates.some(
            (candidate) => candidate.id === personId,
          );
          return (
            <Paper withBorder radius="md" p="sm" key={personId}>
              <Group justify="space-between" align="center" wrap="nowrap">
                <div>
                  <Text fw={600} size="sm">
                    {person?.name ?? "Unknown user"}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {person?.email ?? personId}
                  </Text>
                  {!eligible ? (
                    <Text c="red.7" size="xs" fw={600}>
                      No longer eligible for new assignments
                    </Text>
                  ) : null}
                </div>
                {!disabled ? (
                  <Button
                    type="button"
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    disabled={selectedIds.length <= minimumSelected}
                    onClick={() => {
                      onChange(selectedIds.filter((id) => id !== personId));
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </Group>
            </Paper>
          );
        })
      ) : (
        <Text c="dimmed" size="sm">
          No {label.toLocaleLowerCase("en-AU")} assigned.
        </Text>
      )}
      {!disabled ? (
        <Group align="end" wrap="wrap" grow>
          <LightweightAutocomplete
            label={`Add ${label.toLocaleLowerCase("en-AU")}`}
            placeholder={
              available.length
                ? "Search by name or email"
                : `No eligible ${label.toLocaleLowerCase("en-AU")}s available`
            }
            value={query}
            disabled={available.length === 0}
            options={available.map((candidate) => ({
              value: candidate.email,
              label: candidate.name,
              description: candidate.email,
            }))}
            limit={8}
            onChange={setQuery}
          />
          <Button
            type="button"
            variant="light"
            disabled={!selectedCandidate}
            onClick={() => {
              if (!selectedCandidate) return;
              onChange([...selectedIds, selectedCandidate.id]);
              setQuery("");
            }}
          >
            Add
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
