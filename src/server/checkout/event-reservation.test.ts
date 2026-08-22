import { describe, expect, it } from "vitest";
import {
  EVENT_RESERVATION_MINUTES,
  eventReservationExpiresAt,
} from "./event-reservation";

describe("event commerce reservations", () => {
  it("expires Stripe Checkout at the same boundary as reserved capacity", () => {
    const reservedAt = new Date("2027-08-21T00:00:00.750Z");

    expect(eventReservationExpiresAt(reservedAt)).toBe(
      Math.floor(
        (reservedAt.getTime() + EVENT_RESERVATION_MINUTES * 60_000) / 1000,
      ),
    );
  });
});
