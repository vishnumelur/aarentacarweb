/**
 * The booking lifecycle from spec §4. This is the single definition — the server
 * enforces it, and the web and mobile clients read from it to decide which actions
 * to render. Duplicating this logic anywhere is how the three drift apart.
 *
 * The database's `booking_status` enum carries the same 17 values.
 */

export const BOOKING_STATUSES = [
  'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP',
  'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
  'CANCELLED', 'NO_SHOW', 'EXPIRED',
  'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED',
] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]

/**
 * Allowed successors, keyed by current state. A state with an empty list is terminal.
 *
 * Cancellation is permitted up to and including READY_FOR_PICKUP. Once the vehicle is
 * OUT the booking can only be RETURNED — cancelling a rental the customer is currently
 * driving is not a thing.
 */
const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  DRAFT: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['DOCS_VERIFIED', 'CANCELLED'],
  DOCS_VERIFIED: ['READY_FOR_PICKUP', 'ASSIGNED', 'CANCELLED', 'NO_SHOW'],
  READY_FOR_PICKUP: ['OUT', 'CANCELLED', 'NO_SHOW'],
  OUT: ['RETURNED'],
  RETURNED: ['CLOSING'],
  CLOSING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],

  // Chauffeur dispatch (P2). Included now so the machine is complete and the enum
  // never needs altering later.
  ASSIGNED: ['EN_ROUTE', 'CANCELLED', 'NO_SHOW'],
  EN_ROUTE: ['ARRIVED'],
  ARRIVED: ['IN_TRIP', 'NO_SHOW'],
  IN_TRIP: ['DROPPED'],
  DROPPED: ['CLOSING'],
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function nextStates(from: BookingStatus): readonly BookingStatus[] {
  return TRANSITIONS[from]
}

export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from]
    const suffix = allowed.length > 0 ? allowed.join(', ') : 'none — it is terminal'
    throw new Error(
      `Illegal booking transition ${from} -> ${to}. Allowed from ${from}: ${suffix}.`,
    )
  }
}
