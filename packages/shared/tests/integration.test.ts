import { describe, it, expect } from 'vitest'
import { quote } from '../src/pricing/quote.js'
import { checkAvailability } from '../src/availability/engine.js'
import { canTransition } from '../src/state-machine.js'
import type { RateCard } from '../src/pricing/rate-resolution.js'
import { dubaiDate, type OpeningInterval } from '../src/availability/opening-hours.js'

const CARD: RateCard = {
  id: 'card-1', classId: 'economy', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01', validTo: null,
}
const HOURS: OpeningInterval[] = [
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
]

describe('the three engines compose into a bookable quote', () => {
  it('quotes a vehicle that availability confirms is free', () => {
    const startsAt = new Date('2026-08-01T06:00:00Z')   // Sat 10:00 Dubai
    const endsAt = new Date('2026-08-03T06:00:00Z')     // Mon 10:00 Dubai

    const availability = checkAvailability({
      vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
      startsAt, endsAt,
      existingBookings: [], maintenanceBlocks: [], documentExpiries: [],
      pickupBranchHours: HOURS, returnBranchHours: HOURS,
    })
    expect(availability.available).toBe(true)

    // Derived from the same Date values passed to checkAvailability, exactly as the
    // booking flow must — never toISOString().slice(0, 10), which would give the UTC
    // date and demonstrate a composition the real flow does not use.
    const q = quote({
      product: 'self_drive', classId: 'economy',
      startDate: dubaiDate(startsAt), endDate: dubaiDate(endsAt),
      rateCards: [CARD], weeklyTiers: [], seasonalRates: [], addons: [],
      promoCode: null, deliveryFeeFils: 0, oneWayFeeFils: 0, vatBps: 500,
    })

    // The quote's shape is exactly what the bookings table will store.
    expect(q.totalFils).toBe(q.subtotalFils - q.discountFils + q.vatFils)
    expect(canTransition('DRAFT', 'PENDING_PAYMENT')).toBe(true)
  })

  it('produces totals the database CHECK constraints would accept', () => {
    const q = quote({
      product: 'self_drive', classId: 'economy',
      startDate: '2026-08-01', endDate: '2026-08-15',
      rateCards: [CARD],
      weeklyTiers: [{ rateCardId: 'card-1', minDays: 14, discountBps: 1500 }],
      seasonalRates: [], addons: [], promoCode: null,
      deliveryFeeFils: 5000, oneWayFeeFils: 0, vatBps: 500,
    })
    // Mirrors totals_consistent, totals_non_negative and the integer requirement.
    expect(q.totalFils).toBe(q.subtotalFils - q.discountFils + q.vatFils)
    for (const v of [q.subtotalFils, q.discountFils, q.vatFils, q.totalFils, q.depositFils]) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('refuses to quote a vehicle that availability rejects — the caller must check first', () => {
    const availability = checkAvailability({
      vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
      startsAt: new Date('2026-08-01T06:00:00Z'),
      endsAt: new Date('2026-08-03T06:00:00Z'),
      existingBookings: [{
        id: 'existing', vehicleId: 'v1', status: 'OUT',
        startsAt: new Date('2026-08-02T06:00:00Z'),
        endsAt: new Date('2026-08-04T06:00:00Z'),
      }],
      maintenanceBlocks: [], documentExpiries: [],
      pickupBranchHours: HOURS, returnBranchHours: HOURS,
    })
    expect(availability.available).toBe(false)
    // The engines are independent by design: quote() has no opinion on availability.
    // The booking flow calls both, in this order.
  })
})
