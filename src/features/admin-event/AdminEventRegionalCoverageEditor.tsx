import { useState } from "react";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import type {
  AdminEventOccurrenceRegionalCoverageInput,
  AdminEventOccurrenceRegionalCoverageOptions,
} from "./admin-event.schema";

export function AdminEventRegionalCoverageEditor({
  options,
  value,
  onChange,
}: {
  options: AdminEventOccurrenceRegionalCoverageOptions;
  value: AdminEventOccurrenceRegionalCoverageInput;
  onChange: (value: AdminEventOccurrenceRegionalCoverageInput) => void;
}) {
  const [coordinatorCandidates, setCoordinatorCandidates] = useState<
    Record<string, string>
  >({});
  const currentByRegion = new Map(
    options.currentRegions.map((region) => [region.regionId, region]),
  );
  const configuredByRegion = new Map(
    value.regions.map((region) => [region.regionId, region]),
  );
  const retirementByRegion = new Map(
    value.retirements.map((retirement) => [retirement.regionId, retirement]),
  );
  const regions = new Map(
    options.availableRegions.map((region) => [region.id, region]),
  );
  for (const region of options.currentRegions)
    if (!regions.has(region.regionId))
      regions.set(region.regionId, {
        id: region.regionId,
        name: region.name,
        code: region.code,
        parentName: null,
      });

  function setRegionActive(regionId: string, active: boolean) {
    const current = currentByRegion.get(regionId);
    if (active) {
      const firstCoordinator = options.availableCoordinators.find(
        (coordinator) => coordinator.regionId === regionId,
      );
      const coordinatorIds =
        current?.coordinatorIds ??
        (firstCoordinator ? [firstCoordinator.id] : []);
      onChange({
        regions: [...value.regions, { regionId, coordinatorIds }],
        retirements: value.retirements.filter(
          (retirement) => retirement.regionId !== regionId,
        ),
      });
      return;
    }
    onChange({
      regions: value.regions.filter((region) => region.regionId !== regionId),
      retirements: current
        ? [
            ...value.retirements.filter(
              (retirement) => retirement.regionId !== regionId,
            ),
            { regionId, disposition: "future_only" },
          ]
        : value.retirements,
    });
  }

  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>Regional coverage</Title>
        <Text c="dimmed" size="sm">
          Reconfirm each applicable region and its coordinators. Removing a
          region never silently changes existing registrations.
        </Text>
      </div>
      {[...regions.values()].map((region) => {
        const configured = configuredByRegion.get(region.id);
        const current = currentByRegion.get(region.id);
        const retirement = retirementByRegion.get(region.id);
        const configuredCoordinatorIds = new Set(
          configured?.coordinatorIds ?? [],
        );
        const eligibleCoordinators = options.availableCoordinators.filter(
          (coordinator) => coordinator.regionId === region.id,
        );
        const selectableUsers = eligibleCoordinators.filter(
          (user) => !configuredCoordinatorIds.has(user.id),
        );
        const candidate =
          coordinatorCandidates[region.id] ?? selectableUsers[0]?.id ?? "";
        return (
          <Paper withBorder radius="md" p="sm" key={region.id}>
            <Stack gap="sm">
              <MantineCheckbox
                checked={Boolean(configured)}
                disabled={!configured && eligibleCoordinators.length === 0}
                label={`${region.parentName ? `${region.parentName} — ` : ""}${region.name} (${region.code})`}
                onChange={(active) => {
                  setRegionActive(region.id, active);
                }}
              />
              {configured ? (
                <Stack gap="xs">
                  {configured.coordinatorIds.map((userId) => {
                    const user = options.availableUsers.find(
                      (candidateUser) => candidateUser.id === userId,
                    );
                    return (
                      <Group justify="space-between" key={userId}>
                        <Text size="sm">
                          {user?.name ?? "Unknown user"} ·{" "}
                          {user?.email ?? userId}
                        </Text>
                        <Button
                          type="button"
                          size="compact-xs"
                          variant="subtle"
                          disabled={configured.coordinatorIds.length === 1}
                          onClick={() => {
                            onChange({
                              ...value,
                              regions: value.regions.map((entry) =>
                                entry.regionId === region.id
                                  ? {
                                      ...entry,
                                      coordinatorIds:
                                        entry.coordinatorIds.filter(
                                          (candidateId) =>
                                            candidateId !== userId,
                                        ),
                                    }
                                  : entry,
                              ),
                            });
                          }}
                        >
                          Remove
                        </Button>
                      </Group>
                    );
                  })}
                  {selectableUsers.length ? (
                    <Group align="end" wrap="wrap">
                      <MantineNativeSelect
                        label="Add coordinator"
                        value={candidate}
                        data={selectableUsers.map((user) => ({
                          value: user.id,
                          label: `${user.name} · ${user.email}`,
                        }))}
                        onChange={(event) => {
                          setCoordinatorCandidates((currentCandidates) => ({
                            ...currentCandidates,
                            [region.id]: event.currentTarget.value,
                          }));
                        }}
                      />
                      <Button
                        type="button"
                        variant="light"
                        disabled={!candidate}
                        onClick={() => {
                          onChange({
                            ...value,
                            regions: value.regions.map((entry) =>
                              entry.regionId === region.id
                                ? {
                                    ...entry,
                                    coordinatorIds: [
                                      ...entry.coordinatorIds,
                                      candidate,
                                    ],
                                  }
                                : entry,
                            ),
                          });
                          setCoordinatorCandidates((currentCandidates) => ({
                            ...currentCandidates,
                            [region.id]: "",
                          }));
                        }}
                      >
                        Add
                      </Button>
                    </Group>
                  ) : null}
                </Stack>
              ) : current && retirement ? (
                <Alert color="orange" title="Region will be retired">
                  <Stack gap="xs">
                    <Text size="sm">
                      {current.affectedActiveCount} active registrations,
                      including {current.selectedCount} confirmed places, are
                      affected.
                    </Text>
                    <MantineNativeSelect
                      label="Existing registration treatment"
                      value={retirement.disposition}
                      data={[
                        {
                          value: "future_only",
                          label: "Stop future registrations only",
                        },
                        {
                          value: "cancel_registrations",
                          label: `Cancel ${String(current.affectedActiveCount)} active registrations`,
                        },
                      ]}
                      onChange={(event) => {
                        const disposition = event.currentTarget.value as
                          "future_only" | "cancel_registrations";
                        onChange({
                          ...value,
                          retirements: value.retirements.map((entry) =>
                            entry.regionId === region.id
                              ? { ...entry, disposition }
                              : entry,
                          ),
                        });
                      }}
                    />
                  </Stack>
                </Alert>
              ) : null}
            </Stack>
          </Paper>
        );
      })}
      {!regions.size ? (
        <Alert title="No regional routing configured">
          This event will continue without regional registration review.
        </Alert>
      ) : null}
    </Stack>
  );
}
