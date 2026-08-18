import { useState } from "react";
import { Badge } from "#/features/shared/Badge";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { formatLocalDate } from "#/features/shared/local-date";
import { getAccessOwnerInvoiceUrl } from "#/server/functions/access-owner";
import { startCapacityExtensionCheckout } from "#/server/functions/checkout";
import type { AccessOwnerDashboard } from "./access-owner.schema";
import classes from "./AccessOwnerCommercePanel.module.css";

const audCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

export function AccessOwnerCommercePanel({
  grant,
}: {
  grant: AccessOwnerDashboard["grants"][number];
}) {
  const [reorderQuantity, setReorderQuantity] = useState(5);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [invoicePending, setInvoicePending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reorder(): Promise<void> {
    setCheckoutPending(true);
    setError(null);
    try {
      const result = await startCapacityExtensionCheckout({
        data: { accessGrantId: grant.id, quantity: reorderQuantity },
      });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      setError("Additional access could not be purchased for this grant.");
    } finally {
      setCheckoutPending(false);
    }
  }

  async function viewInvoice(orderId: string): Promise<void> {
    setInvoicePending(orderId);
    setError(null);
    try {
      const result = await getAccessOwnerInvoiceUrl({ data: { orderId } });
      if (result.status !== "ready") {
        setError("The Stripe invoice is not available.");
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("The Stripe invoice could not be opened.");
    } finally {
      setInvoicePending(null);
    }
  }

  return (
    <Stack gap="md">
      {error ? <Alert color="red">{error}</Alert> : null}
      {grant.canReorder ? (
        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <Title order={3} size="h4">
              Purchase more access
            </Title>
            <div className={classes.reorderControls}>
              <MantineTextInput
                label="Additional seats"
                type="number"
                inputMode="numeric"
                min={1}
                value={String(reorderQuantity)}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value);
                  setReorderQuantity(
                    Number.isInteger(value) && value > 0 ? value : 1,
                  );
                }}
              />
              <Button loading={checkoutPending} onClick={() => void reorder()}>
                Continue to Stripe
              </Button>
            </div>
            <Group gap="xs">
              {grant.pricingTiers.map((tier) => (
                <Badge key={tier.minimumQuantity} variant="light">
                  {tier.minimumQuantity}+ seats ·{" "}
                  {audCurrency.format(tier.unitPriceCents / 100)} each
                </Badge>
              ))}
            </Group>
          </Stack>
        </Paper>
      ) : null}
      {grant.orders.length > 0 ? (
        <section>
          <Title order={3} size="h4">
            Orders and payments
          </Title>
          <div className={classes.orderList}>
            {grant.orders.map((order) => (
              <div className={classes.orderRow} key={order.id}>
                <div>
                  <Text fw={700} size="sm">
                    {order.kind === "bulk_purchase"
                      ? "Initial order"
                      : "Additional seats"}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {formatLocalDate(order.createdAt)} · {order.quantity} seats
                    · {audCurrency.format(order.totalCents / 100)}
                  </Text>
                </div>
                <Group gap="xs">
                  <Badge
                    color={
                      order.status === "paid"
                        ? "green"
                        : order.status.includes("refund")
                          ? "orange"
                          : "gray"
                    }
                  >
                    {order.status.replaceAll("_", " ")}
                  </Badge>
                  {order.hasInvoice ? (
                    <Button
                      variant="default"
                      size="xs"
                      loading={invoicePending === order.id}
                      onClick={() => void viewInvoice(order.id)}
                    >
                      View invoice
                    </Button>
                  ) : null}
                </Group>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Stack>
  );
}
