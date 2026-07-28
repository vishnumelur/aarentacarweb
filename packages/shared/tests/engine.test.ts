import { describe, it, expect } from 'vitest'
import { checkAvailability, type AvailabilityInput } from '../src/availability/engine.js'
import type { OpeningInterval } from '../src/availability/opening-hours.js'

const HOURS: OpeningInterval[] = [
  { weekday: 0, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 1, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 2, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 3, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 4, opensAt: '08:00', closesAt: '21:30' },
  { weekday: 5, opensAt: '08:30', closesAt: '12:00' },
  { weekday: 5, opensAt: '17:00', closesAt: '21:30' },
  { weekday: 6, opensAt: '08:00', closesAt: '21:30' },
]

// Saturday 1 Aug 2026, 10:00 Dubai -> Monday 3 Aug, 10:00 Dubai
const START = new Date('2026-08-01T06:00:00Z')
const END = new Date('2026-08-03T06:00:00Z')

const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  vehicle: { id: 'v1', status: 'available', branchId: 'b1' },
  startsAt: START,
  endsAt: END,
  existingBookings: [],
  maintenanceBlocks: [],
  documentExpiries: [],
  pickupBranchHours: HOURS,
  returnBranchHours: HOURS,
  ...over,
})

describe('availability engine', () => {
  it('says available when nothing blocks it', () => {
    const r = checkAvailability(base())
    expect(r.available).toBe(true)
    expect(r.reasons).toHaveLength(0)
  })

  it('blocks a vehicle already booked in an overlapping range (FR-1.2)', () => {
    const r = checkAvailability(base({
      existingBookings: [{
        id: 'b1', vehicleId: 'v1', status: 'CONFIRMED',
        startsAt: new Date('2026-08-02T06:00:00Z'),
        endsAt: new Date('2026-08-06T06:00:00Z'),
      }],
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('booked')
    const booked = r.reasons.find((x) => x.kind === 'booked')
    expect(booked?.kind === 'booked' && booked.conflictingBookingIds).toEqual(['b1'])
  })

  it('permits a back-to-back booking', () => {
    const r = checkAvailability(base({
      existingBookings: [{
        id: 'b1', vehicleId: 'v1', status: 'OUT',
        startsAt: new Date('2026-07-28T06:00:00Z'),
        endsAt: START,
      }],
    }))
    expect(r.available).toBe(true)
  })

  it('blocks a vehicle in the workshop (FR-7.4)', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-08-02', endsOn: '2026-08-04' }],
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('maintenance')
  })

  it('ignores a maintenance block that ended before the rental', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-07-01', endsOn: '2026-07-20' }],
    }))
    expect(r.available).toBe(true)
  })

  it('treats an open-ended maintenance block as blocking', () => {
    const r = checkAvailability(base({
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-07-01', endsOn: null }],
    }))
    expect(r.available).toBe(false)
  })

  it('blocks a vehicle whose mandatory document expires mid-rental (FR-7.2)', () => {
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'insurance', expiresOn: '2026-08-02' }],
    }))
    expect(r.available).toBe(false)
    const reason = r.reasons.find((x) => x.kind === 'document_expired')
    expect(reason?.kind === 'document_expired' && reason.documentType).toBe('insurance')
  })

  it('allows a document expiring after the rental ends', () => {
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'insurance', expiresOn: '2027-01-01' }],
    }))
    expect(r.available).toBe(true)
  })

  it('blocks a document that expires exactly on the return date', () => {
    // The car must be legal for the whole rental, including the day it comes back.
    const r = checkAvailability(base({
      documentExpiries: [{ type: 'mulkiya', expiresOn: '2026-08-03' }],
    }))
    expect(r.available).toBe(false)
  })

  it('blocks a retired or already-rented vehicle', () => {
    for (const status of ['retired', 'maintenance'] as const) {
      const r = checkAvailability(base({ vehicle: { id: 'v1', status, branchId: 'b1' } }))
      expect(r.available, status).toBe(false)
      expect(r.reasons.map((x) => x.kind)).toContain('vehicle_status')
    }
  })

  it('blocks a pickup outside branch opening hours (FR-18.2)', () => {
    // Saturday 23:00 Dubai = 19:00Z, after the 21:30 close
    const r = checkAvailability(base({ startsAt: new Date('2026-08-01T19:00:00Z') }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('pickup_outside_hours')
  })

  it('blocks a return during the Friday prayer gap', () => {
    // Friday 7 Aug, 14:00 Dubai = 10:00Z
    const r = checkAvailability(base({
      startsAt: new Date('2026-08-05T06:00:00Z'),
      endsAt: new Date('2026-08-07T10:00:00Z'),
    }))
    expect(r.available).toBe(false)
    expect(r.reasons.map((x) => x.kind)).toContain('return_outside_hours')
  })

  it('reports every reason, not just the first', () => {
    const r = checkAvailability(base({
      vehicle: { id: 'v1', status: 'retired', branchId: 'b1' },
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-08-01', endsOn: null }],
      documentExpiries: [{ type: 'insurance', expiresOn: '2026-08-02' }],
    }))
    expect(r.available).toBe(false)
    const kinds = r.reasons.map((x) => x.kind)
    expect(kinds).toContain('vehicle_status')
    expect(kinds).toContain('maintenance')
    expect(kinds).toContain('document_expired')
  })

  it('rejects a range that ends before it starts', () => {
    expect(() => checkAvailability(base({ endsAt: new Date('2026-07-01T06:00:00Z') })))
      .toThrow(/not after/i)
  })

  it('rejects a zero-length range rather than reporting the vehicle available', () => {
    // bookings.range_ordered requires ends_at > starts_at strictly. If a vehicle is OUT
    // for the surrounding week, a same-instant range must not slip past this guard and
    // report available only to fail with a raw Postgres error on INSERT.
    expect(() => checkAvailability(base({ endsAt: START })))
      .toThrow(/not after/i)
  })

  it('uses the Dubai business date, not the UTC date, for maintenance (NFR-5)', () => {
    // 2026-08-03T22:00Z is 02:00 on 4 August in Dubai. The true return day is the 4th.
    const r = checkAvailability(base({
      startsAt: new Date('2026-08-01T06:00:00Z'),
      endsAt: new Date('2026-08-03T22:00:00Z'),
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-08-04', endsOn: '2026-08-04' }],
    }))
    expect(r.reasons.map((x) => x.kind)).toContain('maintenance')
  })

  it('uses the Dubai business date, not the UTC date, for document expiry (NFR-5)', () => {
    const r = checkAvailability(base({
      startsAt: new Date('2026-08-01T06:00:00Z'),
      endsAt: new Date('2026-08-03T22:00:00Z'),
      documentExpiries: [{ type: 'insurance', expiresOn: '2026-08-04' }],
    }))
    expect(r.reasons.map((x) => x.kind)).toContain('document_expired')
  })

  it('uses the Dubai business date for a late-evening pickup too', () => {
    // 2026-08-01T21:00Z is 01:00 on 2 August in Dubai — the rental starts on the 2nd.
    const r = checkAvailability(base({
      startsAt: new Date('2026-08-01T21:00:00Z'),
      endsAt: new Date('2026-08-05T06:00:00Z'),
      maintenanceBlocks: [{ id: 'm1', startsOn: '2026-07-20', endsOn: '2026-08-01' }],
    }))
    // The block ended on 1 August; the rental begins on the 2nd in Dubai terms, so it
    // must NOT block. With the UTC bug this would read as starting on the 1st and block.
    expect(r.reasons.map((x) => x.kind)).not.toContain('maintenance')
  })
})
