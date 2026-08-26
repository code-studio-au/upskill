import { PurchaseOfferingButton } from "./PurchaseOfferingButton";
import { startCourseCheckout } from "#/server/functions/checkout";

export function PurchaseCourseButton({ slug }: { slug: string }) {
  return (
    <PurchaseOfferingButton
      accountPath={`/courses/${slug}`}
      alreadyDestination="/dashboard"
      alreadyMessage="This course is already in your learning area."
      alreadyStatus="already-enrolled"
      buttonLabel="Enrol in this course"
      offeringType="course"
      slug={slug}
      startCheckout={() => startCourseCheckout({ data: { slug } })}
    />
  );
}
