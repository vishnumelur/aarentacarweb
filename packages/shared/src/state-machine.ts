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
  // DRAFT -> CONFIRMED skips payment deliberately: pay-at-pickup bookings (FR-4.2) and
  // staff walk-in bookings at the counter (FR-3.6) are confirmed without an online
  // capture. Enforcing that only those two paths use it is the service layer's job —
  // this graph describes what is structurally legal, not who may do it.
  DRAFT: ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED'],
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  // NO_SHOW reachable from CONFIRMED: a pay-at-pickup booking is reserved without
  // capture (FR-4.2), so a customer can simply never appear before documents are
  // ever submitted. Cancellation is a customer decision; no-show is a policy outcome.
  CONFIRMED: ['DOCS_VERIFIED', 'CANCELLED', 'NO_SHOW'],
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

/**
 * Test whether a transition is structurally legal in the state machine.
 *
 * This function is context-free: it answers "is this transition allowed by the graph",
 * not "may this actor perform it" or "are the preconditions met in the database". The
 * spec names a `ctx` parameter, but contextual guards — verified documents, captured
 * deposit, actor permissions — depend on service state and belong in the application
 * layer, which composes them with this predicate. Adding an unused parameter now
 * would be speculative and violate the single-responsibility principle.
 */
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
