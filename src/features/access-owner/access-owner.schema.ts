import { z } from "#/validation/zod";

const identifier = z.string().check(z.trim(), z.minLength(1), z.maxLength(255));

export const accessOwnerGrantInputSchema = z.object({
  accessGrantId: identifier,
});

export const accessOwnerInvoiceInputSchema = z.object({
  orderId: identifier,
});

export interface AccessOwnerDashboard {
  grants: Array<{
    id: string;
    label: string;
    organizationName: string;
    courseTitle: string;
    kind: "bulk_purchase" | "enterprise_contract";
    fulfillmentMode: "shared_code" | "single_use_codes";
    quantity: number;
    redeemed: number;
    remaining: number;
    customerExtendable: boolean;
    canReorder: boolean;
    pricingTiers: Array<{
      minimumQuantity: number;
      unitPriceCents: number;
    }>;
    expiresAt: string | null;
    state: "active" | "exhausted" | "expired" | "revoked";
    learners: Array<{
      enrollmentId: string;
      name: string;
      email: string;
      enrolledAt: string;
      progressPercent: number;
      completionState: "complete" | "incomplete";
      codeNumber: number | null;
    }>;
    orders: Array<{
      id: string;
      kind: "bulk_purchase" | "capacity_extension";
      quantity: number;
      unitPriceCents: number;
      totalCents: number;
      refundedCents: number;
      currency: string;
      status: "pending" | "paid" | "failed" | "partially_refunded" | "refunded";
      hasInvoice: boolean;
      createdAt: string;
    }>;
  }>;
}

export interface AccessOwnerCodeExport {
  accessGrantId: string;
  organizationName: string;
  courseTitle: string;
  codes: Array<{
    codeNumber: number | null;
    accessCode: string;
    status: "available" | "redeemed";
    redeemedAt: string | null;
    learnerName: string | null;
    redemptionEmail: string | null;
  }>;
}

export type AccessOwnerResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" };
