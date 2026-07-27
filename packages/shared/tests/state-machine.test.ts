import { describe, it, expect } from 'vitest'
import {
  BOOKING_STATUSES, canTransition, assertTransition, nextStates, isTerminal,
  type BookingStatus,
} from '../src/state-machine.js'

describe('booking state machine', () => {
  it('knows all 17 statuses from the database enum', () => {
    expect(BOOKING_STATUSES).toHaveLength(17)
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED',
      'READY_FOR_PICKUP', 'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
      'CANCELLED', 'NO_SHOW', 'EXPIRED',
      'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED']) {
      expect(BOOKING_STATUSES).toContain(s)
    }
  })

  it('walks the happy path end to end', () => {
    const path: BookingStatus[] = [
      'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED',
      'READY_FOR_PICKUP', 'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
    ]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!),
        `${path[i]} -> ${path[i + 1]} should be allowed`).toBe(true)
    }
  })

  it('refuses to skip verification before pickup', () => {
    expect(canTransition('CONFIRMED', 'READY_FOR_PICKUP')).toBe(false)
    expect(canTransition('CONFIRMED', 'OUT')).toBe(false)
  })

  it('refuses to move backwards', () => {
    expect(canTransition('OUT', 'CONFIRMED')).toBe(false)
    expect(canTransition('COMPLETED', 'OUT')).toBe(false)
    expect(canTransition('RETURNED', 'READY_FOR_PICKUP')).toBe(false)
  })

  it('allows cancellation only before the car goes out', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CONFIRMED',
      'DOCS_VERIFIED', 'READY_FOR_PICKUP'] as BookingStatus[]) {
      expect(canTransition(s, 'CANCELLED'), `${s} -> CANCELLED`).toBe(true)
    }
    // Once the customer has the car, cancelling is meaningless — it must be returned.
    expect(canTransition('OUT', 'CANCELLED')).toBe(false)
    expect(canTransition('RETURNED', 'CANCELLED')).toBe(false)
  })

  it('expires only an unpaid booking (FR-3.3)', () => {
    expect(canTransition('PENDING_PAYMENT', 'EXPIRED')).toBe(true)
    expect(canTransition('DRAFT', 'EXPIRED')).toBe(true)
    expect(canTransition('CONFIRMED', 'EXPIRED')).toBe(false)
  })

  it('marks no-show only when the car was ready and never collected', () => {
    expect(canTransition('READY_FOR_PICKUP', 'NO_SHOW')).toBe(true)
    expect(canTransition('DOCS_VERIFIED', 'NO_SHOW')).toBe(true)
    expect(canTransition('DRAFT', 'NO_SHOW')).toBe(false)
    expect(canTransition('OUT', 'NO_SHOW')).toBe(false)
  })

  it('treats terminal states as terminal', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as BookingStatus[]) {
      expect(isTerminal(s), `${s} should be terminal`).toBe(true)
      expect(nextStates(s), `${s} should have no successors`).toHaveLength(0)
    }
    expect(isTerminal('OUT')).toBe(false)
  })

  it('never allows a transition to itself', () => {
    for (const s of BOOKING_STATUSES) {
      expect(canTransition(s, s), `${s} -> ${s}`).toBe(false)
    }
  })

  it('routes chauffeur bookings through the dispatch states', () => {
    expect(canTransition('DOCS_VERIFIED', 'ASSIGNED')).toBe(true)
    const trip: BookingStatus[] = ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED']
    for (let i = 0; i < trip.length - 1; i++) {
      expect(canTransition(trip[i]!, trip[i + 1]!)).toBe(true)
    }
    expect(canTransition('DROPPED', 'CLOSING')).toBe(true)
  })

  it('throws a readable error naming both states', () => {
    expect(() => assertTransition('DRAFT', 'COMPLETED'))
      .toThrow(/DRAFT.*COMPLETED/)
  })

  it('has no unreachable state other than DRAFT', () => {
    const reachable = new Set<BookingStatus>(['DRAFT'])
    let grew = true
    while (grew) {
      grew = false
      for (const s of [...reachable]) {
        for (const n of nextStates(s)) {
          if (!reachable.has(n)) { reachable.add(n); grew = true }
        }
      }
    }
    for (const s of BOOKING_STATUSES) {
      expect(reachable.has(s), `${s} is unreachable from DRAFT`).toBe(true)
    }
  })
})
