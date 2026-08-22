import { useForm, useStore } from "@tanstack/react-form";
import { useState } from "react";
import {
  Alert,
  Button,
  Container,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import type { BulkPricing } from "#/features/catalog/catalog.schema";
import {
  bulkOrderCheckoutInputSchema,
  type BulkCheckoutResult,
  type BulkOrderCheckoutInput,
} from "./checkout.schema";
import classes from "#/routes/courses.$slug_.bulk-order.module.css";

const audCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
});

function unitPriceFor(
  tiers: BulkPricing["tiers"],
  quantity: number,
): number | null {
  let price: number | null = null;
  for (const tier of tiers) {
    if (quantity < tier.minimumQuantity) break;
    price = tier.unitPriceCents;
  }
  return price;
}

export function BulkOrderCheckoutPage({
  offeringType,
  title,
  slug,
  bulkPricing,
  startCheckout,
}: {
  offeringType: "course" | "event";
  title: string;
  slug: string;
  bulkPricing: BulkPricing;
  startCheckout: (input: BulkOrderCheckoutInput) => Promise<BulkCheckoutResult>;
}) {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const minimumQuantity = bulkPricing.tiers[0]?.minimumQuantity ?? 2;
  const placeLabel = offeringType === "event" ? "places" : "seats";
  const form = useForm({
    defaultValues: {
      slug,
      organizationName: "",
      quantity: minimumQuantity,
      fulfillmentMode:
        "shared_code" as BulkOrderCheckoutInput["fulfillmentMode"],
    } satisfies BulkOrderCheckoutInput,
    validators: { onSubmit: bulkOrderCheckoutInputSchema },
    onSubmit: async ({ value }) => {
      setCheckoutError(null);
      try {
        const result = await startCheckout(value);
        if (result.status === "redirect") {
          window.location.assign(result.url);
          return;
        }
        if (result.reason === "unauthenticated") {
          const path = offeringType === "course" ? "courses" : "events";
          window.location.assign(
            `/login?redirect=${encodeURIComponent(`/${path}/${slug}/bulk-order`)}`,
          );
          return;
        }
        setCheckoutError(
          result.reason === "quantity"
            ? "Choose a quantity covered by the available pricing tiers."
            : "Checkout could not be started. No payment has been taken.",
        );
      } catch {
        setCheckoutError(
          "Checkout could not be started. No payment has been taken.",
        );
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const unitPrice = unitPriceFor(bulkPricing.tiers, values.quantity);
  const total = unitPrice === null ? null : unitPrice * values.quantity;

  return (
    <Container size="lg" className={classes.page}>
      <Stack gap="xl" className={classes.pageStack}>
        <header className={classes.header}>
          <a
            className={classes.backLink}
            href={`/${offeringType === "course" ? "courses" : "events"}/${slug}`}
          >
            <span aria-hidden="true">&larr;</span> Back to {offeringType}
          </a>
          <Text c="indigo.7" fw={700} className={classes.eyebrow}>
            Bulk {offeringType === "event" ? "event " : ""}access
          </Text>
          <Title order={1} className={classes.title}>
            Purchase {title}
          </Title>
        </header>
        <div className={classes.layout}>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.formCard}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit();
              }}
            >
              <Stack gap="xl">
                <div className={classes.cardHeading}>
                  <Text className={classes.step}>1</Text>
                  <Title order={2} size="h3">
                    Order details
                  </Title>
                </div>
                <MantineTextInput
                  label="Organisation name"
                  value={values.organizationName}
                  maxLength={120}
                  required
                  onChange={(event) => {
                    form.setFieldValue(
                      "organizationName",
                      event.currentTarget.value,
                    );
                  }}
                />
                <div className={classes.fieldGrid}>
                  <MantineTextInput
                    label={`Number of ${placeLabel}`}
                    type="number"
                    inputMode="numeric"
                    min={minimumQuantity}
                    value={String(values.quantity)}
                    required
                    onChange={(event) => {
                      form.setFieldValue(
                        "quantity",
                        Number(event.currentTarget.value),
                      );
                    }}
                  />
                  <MantineNativeSelect
                    label="Code type"
                    value={values.fulfillmentMode}
                    data={[
                      { value: "shared_code", label: "One shared code" },
                      {
                        value: "single_use_codes",
                        label: `One unique code per ${placeLabel.slice(0, -1)}`,
                      },
                    ]}
                    onChange={(event) => {
                      form.setFieldValue(
                        "fulfillmentMode",
                        event.currentTarget
                          .value as BulkOrderCheckoutInput["fulfillmentMode"],
                      );
                    }}
                  />
                </div>
                <section aria-labelledby="pricing-tiers-heading">
                  <Title order={3} size="h4" id="pricing-tiers-heading">
                    Volume pricing
                  </Title>
                  <div className={classes.tiers}>
                    {bulkPricing.tiers.map((tier) => {
                      const active = unitPrice === tier.unitPriceCents;
                      return (
                        <div
                          className={classes.tier}
                          data-active={active || undefined}
                          key={tier.minimumQuantity}
                        >
                          <Text fw={700}>
                            {tier.minimumQuantity}+ {placeLabel}
                          </Text>
                          <Text
                            fw={700}
                            className={active ? classes.activePrice : ""}
                          >
                            {audCurrency.format(tier.unitPriceCents / 100)}
                          </Text>
                          <Text size="xs" c="dimmed">
                            per {placeLabel.slice(0, -1)}
                          </Text>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <form.Subscribe
                  selector={(state) => ({
                    errors: state.errors,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ errors, isSubmitting }) => (
                    <Stack gap="sm">
                      {errors.length > 0 ? (
                        <Alert color="red">Review the order fields.</Alert>
                      ) : null}
                      {checkoutError ? (
                        <Alert color="red">{checkoutError}</Alert>
                      ) : null}
                      <Button
                        size="lg"
                        fullWidth
                        loading={isSubmitting}
                        disabled={unitPrice === null}
                        type="submit"
                      >
                        Continue to Stripe
                      </Button>
                    </Stack>
                  )}
                </form.Subscribe>
              </Stack>
            </form>
          </Paper>
          <Paper
            withBorder
            radius="lg"
            p={{ base: "lg", sm: "xl" }}
            className={classes.summaryCard}
            aria-live="polite"
          >
            <Stack gap="md">
              <div className={classes.cardHeading}>
                <Text className={classes.step}>2</Text>
                <Title order={2} size="h3">
                  Order summary
                </Title>
              </div>
              <div className={classes.courseSummary}>
                <Text fw={700}>{title}</Text>
                <Text size="sm" c="dimmed">
                  {values.fulfillmentMode === "shared_code"
                    ? "Shared access code"
                    : "Unique access codes"}
                </Text>
              </div>
              <div className={classes.summaryRow}>
                <Text>{offeringType === "event" ? "Places" : "Seats"}</Text>
                <Text fw={700}>{values.quantity}</Text>
              </div>
              <div className={classes.summaryRow}>
                <Text>Price per {placeLabel.slice(0, -1)}</Text>
                <Text fw={700}>
                  {unitPrice === null
                    ? "Select an eligible quantity"
                    : audCurrency.format(unitPrice / 100)}
                </Text>
              </div>
              <div className={classes.totalRow}>
                <Text fw={700}>Total</Text>
                <Title order={3} className={classes.totalAmount}>
                  {total === null ? "—" : audCurrency.format(total / 100)}
                </Title>
              </div>
              <Text size="sm" c="dimmed" className={classes.currency}>
                AUD, including applicable GST
              </Text>
            </Stack>
          </Paper>
        </div>
      </Stack>
    </Container>
  );
}
