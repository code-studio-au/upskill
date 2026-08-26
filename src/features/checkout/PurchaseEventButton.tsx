import { PurchaseOfferingButton } from "./PurchaseOfferingButton";
import { startEventCheckout } from "#/server/functions/checkout";

export function PurchaseEventButton({ slug }: { slug: string }) {
  return (
    <PurchaseOfferingButton
      accountPath={`/events/${slug}`}
      alreadyDestination="/my-events"
      alreadyMessage="You are already registered."
      alreadyStatus="already-registered"
      buttonLabel="Purchase event place"
      offeringType="event"
      slug={slug}
      startCheckout={() => startEventCheckout({ data: { slug } })}
    />
  );
}
