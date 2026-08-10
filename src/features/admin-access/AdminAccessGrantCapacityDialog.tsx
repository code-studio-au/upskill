import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { firstFormError } from "#/features/shared/form-errors";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { updateAdminAccessGrantCapacity } from "#/server/functions/admin-access-grant";
import {
  adminAccessGrantCapacitySchema,
  type AdminAccessGrant,
} from "./admin-access.schema";

export function AdminAccessGrantCapacityDialog({
  grant,
  onClose,
  onUpdated,
}: {
  grant: AdminAccessGrant;
  onClose: () => void;
  onUpdated: (outcome: "capacity-updated" | "unchanged") => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const capacityForm = useForm({
    defaultValues: {
      accessGrantId: grant.id,
      quantity: grant.quantity,
    },
    validators: { onSubmit: adminAccessGrantCapacitySchema },
    onSubmit: async ({ value }) => {
      const parsed = adminAccessGrantCapacitySchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      const response = await updateAdminAccessGrantCapacity({
        data: parsed.data,
      });
      if (response.status === "conflict") {
        setError(
          `Capacity cannot be lower than the ${String(grant.redeemed)} places already redeemed.`,
        );
        return;
      }
      if (response.status !== "ready") {
        setError("Capacity could not be updated. Refresh and try again.");
        return;
      }
      if (
        response.data.outcome !== "capacity-updated" &&
        response.data.outcome !== "unchanged"
      ) {
        setError("Capacity could not be updated. Refresh and try again.");
        return;
      }
      await onUpdated(response.data.outcome);
    },
  });

  return (
    <capacityForm.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <AppDialog
          title="Manage access capacity"
          onClose={onClose}
          closeDisabled={isSubmitting}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void capacityForm.handleSubmit();
            }}
          >
            <Stack gap="md">
              <Text>
                {grant.label} has used {grant.redeemed} of {grant.quantity}
                available enrolments. Changing capacity keeps the existing code.
              </Text>
              <capacityForm.Field name="quantity">
                {(field) => (
                  <MantineTextInput
                    label="Total available enrolments"
                    type="number"
                    inputMode="numeric"
                    min={Math.max(1, grant.redeemed)}
                    max={100_000}
                    value={String(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(Number(event.currentTarget.value));
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </capacityForm.Field>
              {error ? (
                <Alert color="red" role="alert">
                  {error}
                </Alert>
              ) : null}
              <Group justify="flex-end">
                <Button
                  type="button"
                  variant="default"
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  Save capacity
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      )}
    </capacityForm.Subscribe>
  );
}
