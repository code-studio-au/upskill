import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import {
  accountInvitationSchema,
  type AccountInvitationInput,
} from "#/features/auth/account-invitation.schema";
import { AppDialog } from "./AppDialog";
import { firstFormError } from "./form-errors";
import { MantineTextInput } from "./MantineTextInput";
import { Alert, Button, Group, Stack, Text } from "./mantine";

export function AccountInviteDialog({
  description,
  onClose,
  onInvite,
  submitLabel,
  title,
}: {
  description: string;
  onClose: () => void;
  onInvite: (input: AccountInvitationInput) => Promise<string | null>;
  submitLabel: string;
  title: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { name: "", email: "" },
    validators: { onSubmit: accountInvitationSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const failure = await onInvite(value);
      if (failure) setError(failure);
    },
  });
  return (
    <AppDialog title={title} onClose={onClose}>
      <Text c="dimmed" size="sm">
        {description}
      </Text>
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <Stack gap="md">
          <form.Field name="name">
            {(field) => (
              <MantineTextInput
                label="Full name"
                autoComplete="name"
                withAsterisk
                value={field.state.value}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </form.Field>
          <form.Field name="email">
            {(field) => (
              <MantineTextInput
                label="Email address"
                type="email"
                autoComplete="email"
                withAsterisk
                value={field.state.value}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </form.Field>
          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) =>
                [state.canSubmit, state.isSubmitting] as const
              }
            >
              {([canSubmit, isSubmitting]) => (
                <Button
                  type="submit"
                  disabled={!canSubmit}
                  loading={isSubmitting}
                >
                  {submitLabel}
                </Button>
              )}
            </form.Subscribe>
          </Group>
        </Stack>
      </form>
    </AppDialog>
  );
}
