import { findConflictingBookings } from './overlap.js'
import { isWithinOpeningHours } from './opening-hours.js'
import type {
  AvailabilityInput, AvailabilityResult, UnavailableReason,
} from './types.js'

export type {
  AvailabilityInput, AvailabilityResult, UnavailableReason,
  VehicleForAvailability, MaintenanceBlock, VehicleDocumentExpiry, VehicleStatus,
} from './types.js'

/** `YYYY-MM-DD` of a UTC instant. Used to compare against date-typed columns. */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

/**
 * Whether a vehicle can be booked for a range, and if not, every reason why.
 *
 * All reasons are collected rather than short-circuiting, so staff see the full
 * picture — a car can be both in the workshop and out of insurance, and fixing
 * only the first still leaves it unbookable.
 *
 * This is the PRIMARY guard against double-booking. Migration `0017`'s exclusion
 * constraint is a backstop: anything this permits but the database rejects reaches
 * the customer as a raw Postgres error rather than a graceful message.
 */
export function checkAvailability(input: AvailabilityInput): AvailabilityResult {
  if (input.endsAt.getTime() < input.startsAt.getTime()) {
    throw new Error(
      `Return ${input.endsAt.toISOString()} is before pickup ${input.startsAt.toISOString()}`,
    )
  }

  const reasons: UnavailableReason[] = []

  if (input.vehicle.status !== 'available') {
    reasons.push({ kind: 'vehicle_status', status: input.vehicle.status })
  }

  const conflicts = findConflictingBookings(
    input.existingBookings, input.vehicle.id, input.startsAt, input.endsAt,
  )
  if (conflicts.length > 0) {
    reasons.push({ kind: 'booked', conflictingBookingIds: conflicts.map((b) => b.id) })
  }

  const startDate = isoDate(input.startsAt)
  const endDate = isoDate(input.endsAt)

  const blocking = input.maintenanceBlocks.filter(
    (m) => m.startsOn <= endDate && (m.endsOn === null || m.endsOn >= startDate),
  )
  if (blocking.length > 0) {
    reasons.push({ kind: 'maintenance', blockIds: blocking.map((m) => m.id) })
  }

  // The vehicle must be legal for the whole rental, including the return day.
  for (const doc of input.documentExpiries) {
    if (doc.expiresOn <= endDate) {
      reasons.push({
        kind: 'document_expired', documentType: doc.type, expiresOn: doc.expiresOn,
      })
    }
  }

  if (!isWithinOpeningHours(input.pickupBranchHours, input.startsAt)) {
    reasons.push({ kind: 'pickup_outside_hours' })
  }
  if (!isWithinOpeningHours(input.returnBranchHours, input.endsAt)) {
    reasons.push({ kind: 'return_outside_hours' })
  }

  return { available: reasons.length === 0, reasons }
}
