import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  VEHICLE_HOLDING_STATUSES, holdsVehicle, rangesOverlap, findConflictingBookings,
  type ExistingBooking,
} from '../src/availability/overlap.js'
import { BOOKING_STATUSES, type BookingStatus } from '../src/state-machine.js'

const d = (iso: string) => new Date(iso)

const booking = (
  id: string, status: BookingStatus, startsAt: string, endsAt: string,
  vehicleId: string | null = 'v1',
): ExistingBooking => ({ id, vehicleId, status, startsAt: d(startsAt), endsAt: d(endsAt) })

describe('which statuses hold a vehicle', () => {
  it('matches migration 0017 exactly', () => {
    expect([...VEHICLE_HOLDING_STATUSES].sort()).toEqual(
      ['CONFIRMED', 'DOCS_VERIFIED', 'OUT', 'READY_FOR_PICKUP'],
    )
  })

  // This is the only test file in packages/shared permitted to touch the filesystem.
  // It is a build-time consistency check between two packages (this constant vs. the
  // SQL migration's status filter), not runtime logic, so it does not violate the
  // no-I/O rule that applies to src/. Do not "fix" this by deleting the file read.
  it('matches migration 0017 read from disk, not a hardcoded copy', () => {
    const sql = readFileSync(
      resolve(import.meta.dirname, '../../db/migrations/0017_bookings_no_vehicle_overlap.sql'),
      'utf8',
    )
    // Pull the statuses out of the constraint's WHERE ... status IN (...) clause.
    const inClause = sql.match(/"status"\s+IN\s*\(([^)]*)\)/i)?.[1]
    expect(inClause, 'could not find the status IN clause in migration 0017').toBeDefined()
    const fromSql = [...inClause!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!).sort()
    expect(fromSql).toEqual([...VEHICLE_HOLDING_STATUSES].sort())
  })

  it('does not hold a vehicle before confirmation or after return', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'RETURNED', 'CLOSING',
      'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'] as BookingStatus[]) {
      expect(holdsVehicle(s), `${s} must not hold a vehicle`).toBe(false)
    }
  })

  it('classifies all 17 statuses explicitly, with no untested value', () => {
    const expected: Record<BookingStatus, boolean> = {
      DRAFT: false, PENDING_PAYMENT: false,
      CONFIRMED: true, DOCS_VERIFIED: true, READY_FOR_PICKUP: true, OUT: true,
      RETURNED: false, CLOSING: false, COMPLETED: false,
      CANCELLED: false, NO_SHOW: false, EXPIRED: false,
      // Chauffeur dispatch (P2). A chauffeur booking's vehicle is held by the
      // underlying self-drive-style reservation, not by the trip state, so none
      // of these hold a vehicle on their own. Confirmed against migration 0017:
      // none of these five appear in its status filter.
      ASSIGNED: false, EN_ROUTE: false, ARRIVED: false, IN_TRIP: false, DROPPED: false,
    }
    for (const status of BOOKING_STATUSES) {
      expect(holdsVehicle(status), `${status}`).toBe(expected[status])
    }
  })
})

describe('range overlap', () => {
  it('detects a range fully inside another', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-10T00:00:00Z'),
      d('2026-08-03T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('detects partial overlap at either end', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-04T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(true)
    expect(rangesOverlap(
      d('2026-08-04T00:00:00Z'), d('2026-08-08T00:00:00Z'),
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('treats touching ranges as NOT overlapping — one returns as the next collects', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-05T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(false)
  })

  it('detects a one-second overlap', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:01Z'),
      d('2026-08-05T00:00:00Z'), d('2026-08-08T00:00:00Z'),
    )).toBe(true)
  })

  it('detects identical ranges', () => {
    expect(rangesOverlap(
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
      d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'),
    )).toBe(true)
  })

  it('treats a zero-length range as empty, matching Postgres tstzrange(t, t)', () => {
    const t = d('2026-08-03T00:00:00Z')
    // A zero-length range overlaps nothing, even an instant strictly inside another range.
    expect(rangesOverlap(t, t, d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'))).toBe(false)
    expect(rangesOverlap(d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'), t, t)).toBe(false)
  })

  it('treats an inverted range as empty rather than silently matching', () => {
    expect(rangesOverlap(
      d('2026-08-05T00:00:00Z'), d('2026-08-01T00:00:00Z'),
      d('2026-08-02T00:00:00Z'), d('2026-08-04T00:00:00Z'),
    )).toBe(false)
  })

  it('is symmetric for every case', () => {
    const cases: Array<[string, string, string, string]> = [
      ['2026-08-01', '2026-08-05', '2026-08-03', '2026-08-09'],
      ['2026-08-01', '2026-08-05', '2026-08-05', '2026-08-09'],
      ['2026-08-01', '2026-08-05', '2026-08-06', '2026-08-09'],
      ['2026-08-01', '2026-08-31', '2026-08-10', '2026-08-11'],
    ]
    for (const [a1, a2, b1, b2] of cases) {
      const fwd = rangesOverlap(d(`${a1}T00:00:00Z`), d(`${a2}T00:00:00Z`), d(`${b1}T00:00:00Z`), d(`${b2}T00:00:00Z`))
      const rev = rangesOverlap(d(`${b1}T00:00:00Z`), d(`${b2}T00:00:00Z`), d(`${a1}T00:00:00Z`), d(`${a2}T00:00:00Z`))
      expect(fwd, `${a1}..${a2} vs ${b1}..${b2}`).toBe(rev)
    }
  })
})

describe('finding conflicting bookings', () => {
  it('finds an overlapping CONFIRMED booking on the same vehicle', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
    const found = findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))
    expect(found.map((b) => b.id)).toEqual(['b1'])
  })

  it('ignores a booking on a different vehicle', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', 'v2')]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))).toHaveLength(0)
  })

  it('ignores a booking with no vehicle assigned', () => {
    const existing = [booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z', null)]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))).toHaveLength(0)
  })

  it('ignores overlapping bookings in a status that does not hold the vehicle', () => {
    for (const s of ['DRAFT', 'PENDING_PAYMENT', 'CANCELLED', 'COMPLETED',
      'NO_SHOW', 'EXPIRED', 'RETURNED'] as BookingStatus[]) {
      const existing = [booking('b1', s, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
      expect(
        findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z')),
        `${s} should not conflict`,
      ).toHaveLength(0)
    }
  })

  it('conflicts on every status that does hold the vehicle', () => {
    for (const s of VEHICLE_HOLDING_STATUSES) {
      const existing = [booking('b1', s, '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z')]
      expect(
        findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z')),
        `${s} should conflict`,
      ).toHaveLength(1)
    }
  })

  it('permits a back-to-back booking starting exactly when the last ends', () => {
    const existing = [booking('b1', 'OUT', '2026-08-01T00:00:00Z', '2026-08-05T10:00:00Z')]
    expect(findConflictingBookings(existing, 'v1', d('2026-08-05T10:00:00Z'), d('2026-08-09T00:00:00Z'))).toHaveLength(0)
  })

  it('returns every conflict, not just the first', () => {
    const existing = [
      booking('b1', 'CONFIRMED', '2026-08-01T00:00:00Z', '2026-08-04T00:00:00Z'),
      booking('b2', 'OUT', '2026-08-06T00:00:00Z', '2026-08-09T00:00:00Z'),
      booking('b3', 'CANCELLED', '2026-08-02T00:00:00Z', '2026-08-08T00:00:00Z'),
    ]
    const found = findConflictingBookings(existing, 'v1', d('2026-08-03T00:00:00Z'), d('2026-08-07T00:00:00Z'))
    expect(found.map((b) => b.id).sort()).toEqual(['b1', 'b2'])
  })

  it('handles an empty booking list', () => {
    expect(findConflictingBookings([], 'v1', d('2026-08-01T00:00:00Z'), d('2026-08-05T00:00:00Z'))).toHaveLength(0)
  })
})
