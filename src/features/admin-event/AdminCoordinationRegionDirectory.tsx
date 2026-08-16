import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { Badge } from "#/features/shared/Badge";
import { firstFormError } from "#/features/shared/form-errors";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  adminCoordinationRegionSaveSchema,
  type AdminEventWorkspace,
} from "./admin-event.schema";
import {
  saveAdminCoordinationRegion,
  setAdminCoordinationRegionStatus,
} from "#/server/functions/admin-event";

type Region = AdminEventWorkspace["regions"][number];
type RegionDialogState =
  | { mode: "create"; kind: "group" | "operational" }
  | { mode: "edit"; region: Region };

export function AdminCoordinationRegionDirectory({
  regions,
  onChanged,
}: {
  regions: AdminEventWorkspace["regions"];
  onChanged: () => Promise<void>;
}) {
  const [dialog, setDialog] = useState<RegionDialogState | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = regions.filter((region) => region.kind === "group");
  const ungrouped = regions.filter(
    (region) => region.kind === "operational" && region.parentId === null,
  );

  async function changeStatus(region: Region) {
    setProcessingId(region.id);
    setError(null);
    try {
      const status = region.status === "active" ? "retired" : "active";
      const result = await setAdminCoordinationRegionStatus({
        data: { regionId: region.id, status },
      });
      if (result.status === "conflict") {
        setError(
          region.kind === "group"
            ? "Retire or move every active child region before retiring this group."
            : "The region cannot be reactivated until its parent group is active.",
        );
        return;
      }
      if (result.status !== "ready") {
        setError("The region status could not be changed.");
        return;
      }
      await onChanged();
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Title order={2}>Coordination regions</Title>
          <Text c="dimmed" size="sm">
            Group operational regions under jurisdictions such as NSW or
            Victoria. Event templates may combine operational regions from any
            group, while each region keeps its own coordinator review list.
          </Text>
        </div>
        <Group>
          <Button
            variant="default"
            onClick={() => {
              setDialog({ mode: "create", kind: "group" });
            }}
          >
            Add region group
          </Button>
          <Button
            onClick={() => {
              setDialog({ mode: "create", kind: "operational" });
            }}
          >
            Add operational region
          </Button>
        </Group>
      </Group>
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}
      {groups.length === 0 && ungrouped.length === 0 ? (
        <Alert title="No coordination regions">
          Create a jurisdiction group, then add the operational regions used for
          registration review.
        </Alert>
      ) : null}
      {groups.map((group) => (
        <RegionGroup
          key={group.id}
          group={group}
          regions={regions.filter(
            (region) =>
              region.kind === "operational" && region.parentId === group.id,
          )}
          processingId={processingId}
          onEdit={(region) => {
            setDialog({ mode: "edit", region });
          }}
          onChangeStatus={changeStatus}
        />
      ))}
      {ungrouped.length ? (
        <RegionGroup
          group={null}
          regions={ungrouped}
          processingId={processingId}
          onEdit={(region) => {
            setDialog({ mode: "edit", region });
          }}
          onChangeStatus={changeStatus}
        />
      ) : null}
      {dialog ? (
        <RegionDialog
          key={dialog.mode === "edit" ? dialog.region.id : `new-${dialog.kind}`}
          state={dialog}
          groups={groups}
          onClose={() => {
            setDialog(null);
          }}
          onSaved={async () => {
            setDialog(null);
            await onChanged();
          }}
        />
      ) : null}
    </Stack>
  );
}

function RegionGroup({
  group,
  regions,
  processingId,
  onEdit,
  onChangeStatus,
}: {
  group: Region | null;
  regions: Array<Region>;
  processingId: string | null;
  onEdit: (region: Region) => void;
  onChangeStatus: (region: Region) => Promise<void>;
}) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="start" wrap="wrap">
          <div>
            <Group gap="xs">
              <Title order={3}>{group?.name ?? "Ungrouped regions"}</Title>
              {group ? (
                <Badge
                  color={group.status === "active" ? "green" : "gray"}
                  variant="light"
                >
                  {group.status}
                </Badge>
              ) : null}
            </Group>
            {group ? (
              <Text c="dimmed" size="sm">
                {group.code}
              </Text>
            ) : null}
          </div>
          {group ? (
            <RegionActions
              region={group}
              processing={processingId === group.id}
              onEdit={onEdit}
              onChangeStatus={onChangeStatus}
            />
          ) : null}
        </Group>
        {regions.length ? (
          regions.map((region) => (
            <Paper withBorder radius="md" p="sm" key={region.id}>
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Group gap="xs">
                    <Text fw={700}>{region.name}</Text>
                    <Badge
                      color={region.status === "active" ? "green" : "gray"}
                      variant="light"
                    >
                      {region.status}
                    </Badge>
                  </Group>
                  <Text c="dimmed" size="sm">
                    {region.code}
                  </Text>
                </div>
                <RegionActions
                  region={region}
                  processing={processingId === region.id}
                  onEdit={onEdit}
                  onChangeStatus={onChangeStatus}
                />
              </Group>
            </Paper>
          ))
        ) : (
          <Text c="dimmed" size="sm">
            No operational regions in this group.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function RegionActions({
  region,
  processing,
  onEdit,
  onChangeStatus,
}: {
  region: Region;
  processing: boolean;
  onEdit: (region: Region) => void;
  onChangeStatus: (region: Region) => Promise<void>;
}) {
  return (
    <Group gap="xs">
      <Button
        size="xs"
        variant="default"
        onClick={() => {
          onEdit(region);
        }}
      >
        Edit
      </Button>
      <Button
        size="xs"
        color={region.status === "active" ? "red" : "green"}
        variant="subtle"
        loading={processing}
        onClick={() => void onChangeStatus(region)}
      >
        {region.status === "active" ? "Retire" : "Reactivate"}
      </Button>
    </Group>
  );
}

function RegionDialog({
  state,
  groups,
  onClose,
  onSaved,
}: {
  state: RegionDialogState;
  groups: Array<Region>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const current = state.mode === "edit" ? state.region : null;
  const kind = state.mode === "edit" ? state.region.kind : state.kind;
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      regionId: current?.id ?? null,
      name: current?.name ?? "",
      code: current?.code ?? "",
      kind,
      parentId: current?.parentId ?? null,
    },
    validators: { onSubmit: adminCoordinationRegionSaveSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const result = await saveAdminCoordinationRegion({ data: value });
      if (result.status === "conflict") {
        setError(
          result.reason === "region_code_in_use"
            ? "That region code is already in use."
            : "The selected hierarchy is not valid.",
        );
        return;
      }
      if (result.status !== "ready") {
        setError("The region could not be saved.");
        return;
      }
      await onSaved();
    },
  });

  return (
    <AppDialog
      title={`${current ? "Edit" : "Add"} ${kind === "group" ? "region group" : "operational region"}`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <Stack gap="md">
          {error ? (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          ) : null}
          <form.Field name="name">
            {(field) => (
              <MantineTextInput
                label={kind === "group" ? "Group name" : "Region name"}
                value={field.state.value}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </form.Field>
          <form.Field name="code">
            {(field) => (
              <MantineTextInput
                label="Short code"
                description="Unique uppercase admin reference used in filters, imports and exports, such as NSW or SLHD."
                value={field.state.value}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </form.Field>
          {kind === "operational" ? (
            <form.Field name="parentId">
              {(field) => (
                <MantineNativeSelect
                  label="Region group"
                  value={field.state.value ?? ""}
                  error={firstFormError(field.state.meta.errors)}
                  data={[
                    { value: "", label: "No parent group" },
                    ...groups
                      .filter((group) => group.status === "active")
                      .map((group) => ({
                        value: group.id,
                        label: `${group.name} · ${group.code}`,
                      })),
                  ]}
                  onChange={(event) => {
                    field.handleChange(event.currentTarget.value || null);
                  }}
                />
              )}
            </form.Field>
          ) : null}
          <Group justify="end">
            <Button type="button" variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(formState) =>
                [formState.canSubmit, formState.isSubmitting] as const
              }
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  loading={isSubmitting}
                  disabled={!canSubmit}
                >
                  Save region
                </Button>
              )}
            </form.Subscribe>
          </Group>
        </Stack>
      </form>
    </AppDialog>
  );
}
