export const EVENT_RESERVATION_MINUTES = 31;

export function eventReservationExpiresAt(now: Date): number {
  return Math.floor(
    (now.getTime() + EVENT_RESERVATION_MINUTES * 60_000) / 1000,
  );
}
