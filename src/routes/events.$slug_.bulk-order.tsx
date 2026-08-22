import { createFileRoute, notFound } from "@tanstack/react-router";
import { BulkOrderCheckoutPage } from "#/features/checkout/BulkOrderCheckoutPage";
import { getEvent } from "#/server/functions/catalog";
import { startEventBulkOrderCheckout } from "#/server/functions/checkout";

export const Route = createFileRoute("/events/$slug_/bulk-order")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const event = await getEvent({ data: { slug: params.slug } });
    if (!event?.bulkPricing.enabled || event.bulkPricing.tiers.length === 0)
      throw notFound();
    return event;
  },
  component: EventBulkOrderRoute,
});

function EventBulkOrderRoute() {
  const event = Route.useLoaderData();
  return (
    <BulkOrderCheckoutPage
      offeringType="event"
      title={event.title}
      slug={event.slug}
      bulkPricing={event.bulkPricing}
      startCheckout={async (input) =>
        await startEventBulkOrderCheckout({ data: input })
      }
    />
  );
}
