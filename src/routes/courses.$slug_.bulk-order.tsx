import { createFileRoute, notFound } from "@tanstack/react-router";
import { BulkOrderCheckoutPage } from "#/features/checkout/BulkOrderCheckoutPage";
import { getCourse } from "#/server/functions/catalog";
import { startBulkOrderCheckout } from "#/server/functions/checkout";

export const Route = createFileRoute("/courses/$slug_/bulk-order")({
  ssr: "data-only",
  loader: async ({ params }) => {
    const course = await getCourse({ data: { slug: params.slug } });
    if (!course?.bulkPricing.enabled || course.bulkPricing.tiers.length === 0)
      throw notFound();
    return course;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `Bulk access — ${loaderData.title} — Upskill`
          : "Bulk access — Upskill",
      },
    ],
  }),
  component: CourseBulkOrderRoute,
});

function CourseBulkOrderRoute() {
  const course = Route.useLoaderData();
  return (
    <BulkOrderCheckoutPage
      offeringType="course"
      title={course.title}
      slug={course.slug}
      bulkPricing={course.bulkPricing}
      startCheckout={async (input) =>
        await startBulkOrderCheckout({ data: input })
      }
    />
  );
}
