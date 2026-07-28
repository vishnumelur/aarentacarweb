import type { BookingStatus } from '../state-machine.js'

/**
 * The statuses in which a booking is holding a physical vehicle.
 *
 * This list MUST stay identical to the status filter in migration `0017`'s
 * `bookings_no_vehicle_overlap` exclusion constraint. That constraint is the
 * database backstop; this is the primary guard. If they disagree, a booking this
 * engine permits gets rejected by Postgres and reaches the customer as a raw
 * database error instead of "no longer available".
 */
export const VEHICLE_HOLDING_STATUSES = [
  'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP', 'OUT',
] as const satisfies readonly BookingStatus[]

export function holdsVehicle(status: BookingStatus): boolean {
  return (VEHICLE_HOLDING_STATUSES as readonly BookingStatus[]).includes(status)
}

export interface ExistingBooking {
  readonly id: string
  readonly vehicleId: string | null
  readonly status: BookingStatus
  readonly startsAt: Date
  readonly endsAt: Date
}

/**
 * Half-open intervals: `[start, end)`. Two ranges that merely touch do NOT overlap,
 * so one customer returning at 10:00 and the next collecting at 10:00 is legal.
 * This matches Postgres `tstzrange(a, b)` default bounds, which the exclusion
 * constraint in migration `0017` relies on.
 */
export function rangesOverlap(
  aStart: Date, aEnd: Date, bStart: Date, bEnd: Date,
): boolean {
  // Postgres canonicalises tstzrange(t, t) to empty, and empty overlaps nothing.
  // Matching that matters: migration 0017's exclusion constraint is the backstop for
  // this function, and the two must agree or a booking this permits gets rejected by
  // the database as a raw error.
  if (aStart.getTime() >= aEnd.getTime()) return false
  if (bStart.getTime() >= bEnd.getTime()) return false
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

/**
 * Every existing booking that would collide with the proposed range on this vehicle.
 * Returns all of them rather than the first, so the caller can explain the conflict.
 */
export function findConflictingBookings(
  bookings: readonly ExistingBooking[],
  vehicleId: string,
  startsAt: Date,
  endsAt: Date,
): readonly ExistingBooking[] {
  return bookings.filter(
    (b) =>
      b.vehicleId === vehicleId &&
      holdsVehicle(b.status) &&
      rangesOverlap(b.startsAt, b.endsAt, startsAt, endsAt),
  )
}
