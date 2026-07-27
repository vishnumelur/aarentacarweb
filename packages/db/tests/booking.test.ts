import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  users, customers, branches, vehicleClasses, vehicles, rateCards,
  bookings, selfDriveDetails,
} from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

async function fixtures() {
  const [user] = await db.insert(users)
    .values({ phone: '+971505555555', role: 'customer', fullName: 'Booker' }).returning()
  const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
  const [branch] = await db.insert(branches).values({
    name: 'Al Karama', slug: 'al-karama',
    addressLine: 'Khalifa bin Zayed Street', phone: '+971503377877',
  }).returning()
  const [cls] = await db.insert(vehicleClasses)
    .values({ name: 'Economy', slug: 'economy' }).returning()
  const [vehicle] = await db.insert(vehicles).values({
    registration: 'D-22222', classId: cls!.id, branchId: branch!.id,
    make: 'Hyundai', model: 'Accent', year: 2021, colour: 'White',
    odometerKm: 40000, acquisitionCostFils: 4500000,
  }).returning()
  const [card] = await db.insert(rateCards).values({
    classId: cls!.id, dailyRateFils: 12000, depositFils: 100000,
    includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01',
  }).returning()
  return { customer: customer!, branch: branch!, vehicle: vehicle!, card: card! }
}

describe('booking schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE booking_addons, self_drive_details, bookings,
                     rate_cards, vehicles, vehicle_classes, branches, customers, users
      RESTART IDENTITY CASCADE`)
  })

  it('creates a booking in DRAFT with a unique reference', async () => {
    const f = await fixtures()
    const [booking] = await db.insert(bookings).values({
      reference: 'AA-2026-000001',
      customerId: f.customer.id,
      product: 'self_drive',
      vehicleId: f.vehicle.id,
      rateCardId: f.card.id,
      startsAt: new Date('2026-08-01T08:00:00Z'),
      endsAt: new Date('2026-08-08T08:00:00Z'),
      subtotalFils: 84000,
      vatFils: 4200,
      totalFils: 88200,
      depositFils: 100000,
    }).returning()
    expect(booking!.status).toBe('DRAFT')
  })

  it('rejects a booking that ends before it starts', async () => {
    const f = await fixtures()
    await expect(db.insert(bookings).values({
      reference: 'AA-2026-000002', customerId: f.customer.id, product: 'self_drive',
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-08-08T08:00:00Z'),
      endsAt: new Date('2026-08-01T08:00:00Z'),
      subtotalFils: 1, vatFils: 0, totalFils: 1, depositFils: 0,
    })).rejects.toThrow()
  })

  it('rejects a duplicate booking reference', async () => {
    const f = await fixtures()
    const base = {
      customerId: f.customer.id, product: 'self_drive' as const,
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-09-01T08:00:00Z'),
      endsAt: new Date('2026-09-03T08:00:00Z'),
      subtotalFils: 24000, vatFils: 1200, totalFils: 25200, depositFils: 100000,
    }
    await db.insert(bookings).values({ ...base, reference: 'AA-2026-000003' })
    await expect(db.insert(bookings).values({ ...base, reference: 'AA-2026-000003' })).rejects.toThrow()
  })

  it('pins the rate card so historic bookings never reprice (FR-17.7)', async () => {
    const f = await fixtures()
    const [booking] = await db.insert(bookings).values({
      reference: 'AA-2026-000004', customerId: f.customer.id, product: 'self_drive',
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-08-01T08:00:00Z'),
      endsAt: new Date('2026-08-03T08:00:00Z'),
      subtotalFils: 24000, vatFils: 1200, totalFils: 25200, depositFils: 100000,
    }).returning()
    expect(booking!.rateCardId).toBe(f.card.id)
  })

  it('stores self-drive detail with pickup and return branches', async () => {
    const f = await fixtures()
    const [booking] = await db.insert(bookings).values({
      reference: 'AA-2026-000005', customerId: f.customer.id, product: 'self_drive',
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-08-01T08:00:00Z'),
      endsAt: new Date('2026-08-03T08:00:00Z'),
      subtotalFils: 24000, vatFils: 1200, totalFils: 25200, depositFils: 100000,
    }).returning()
    const [detail] = await db.insert(selfDriveDetails).values({
      bookingId: booking!.id,
      pickupBranchId: f.branch.id,
      returnBranchId: f.branch.id,
      includedKmTotal: 500,
    }).returning()
    expect(detail!.includedKmTotal).toBe(500)
  })

  it('accepts every state in the spec state machine', async () => {
    const states = [
      'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP',
      'OUT', 'RETURNED', 'CLOSING', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED',
    ]
    const result = await db.execute<{ enumlabel: string }>(sql`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'booking_status'`)
    const labels = result.rows.map((r) => r.enumlabel)
    for (const state of states) expect(labels).toContain(state)
  })
})
