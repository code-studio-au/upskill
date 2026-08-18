import { createServerFn } from "@tanstack/react-start";
import {
  bulkOrderCheckoutInputSchema,
  capacityExtensionCheckoutInputSchema,
  checkoutCourseInputSchema,
  checkoutStatusInputSchema,
} from "#/features/checkout/checkout.schema";

export const startBulkOrderCheckout = createServerFn({ method: "POST" })
  .validator(bulkOrderCheckoutInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user)
      return { status: "unavailable", reason: "unauthenticated" } as const;
    const { createInitialBulkCheckout } =
      await import("#/server/checkout/bulk-checkout.server");
    return await createInitialBulkCheckout(data, user);
  });

export const startCapacityExtensionCheckout = createServerFn({ method: "POST" })
  .validator(capacityExtensionCheckoutInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user)
      return { status: "unavailable", reason: "unauthenticated" } as const;
    const { createCapacityExtensionCheckout } =
      await import("#/server/checkout/bulk-checkout.server");
    return await createCapacityExtensionCheckout(data, user);
  });

export const startCourseCheckout = createServerFn({ method: "POST" })
  .validator(checkoutCourseInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { createCourseCheckout } =
      await import("#/server/checkout/course-checkout.server");
    return await createCourseCheckout(data.slug, user);
  });

export const getCourseCheckoutStatus = createServerFn({ method: "GET" })
  .validator(checkoutStatusInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { findCheckoutStatus } =
      await import("#/server/checkout/checkout-status.server");
    const checkout = await findCheckoutStatus(data.sessionId, user);
    return checkout
      ? ({ status: "found", checkout } as const)
      : ({ status: "not-found" } as const);
  });
