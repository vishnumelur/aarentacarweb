import { describe, it, expect, beforeEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  settings, contentPages, termsVersions,
  users, customers, branches, vehicleClasses, vehicles, rateCards, bookings,
} from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

// Mirrors the fixtures() helper in booking.test.ts — a self-drive booking needs
// a customer, vehicle and rate card in place before it can be inserted.
async function bookingFixtures() {
  const [user] = await db.insert(users)
    .values({ phone: '+971505555556', role: 'customer', fullName: 'Terms Booker' }).returning()
  const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
  const [branch] = await db.insert(branches).values({
    name: 'Al Karama', slug: 'al-karama',
    addressLine: 'Khalifa bin Zayed Street', phone: '+971503377877',
  }).returning()
  const [cls] = await db.insert(vehicleClasses)
    .values({ name: 'Economy', slug: 'economy' }).returning()
  const [vehicle] = await db.insert(vehicles).values({
    registration: 'D-33333', classId: cls!.id, branchId: branch!.id,
    make: 'Hyundai', model: 'Accent', year: 2021, colour: 'White',
    odometerKm: 40000, acquisitionCostFils: 4500000,
  }).returning()
  const [card] = await db.insert(rateCards).values({
    classId: cls!.id, dailyRateFils: 12000, depositFils: 100000,
    includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01',
  }).returning()
  return { customer: customer!, vehicle: vehicle!, card: card! }
}

describe('settings and content schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE terms_versions, content_pages, settings, bookings,
                     rate_cards, vehicles, vehicle_classes, branches, customers, users
      RESTART IDENTITY CASCADE`)
  })

  it('stores VAT as basis points so it is never hardcoded in a query', async () => {
    await db.insert(settings).values({ key: 'vat_bps', value: 500 })
    const [row] = await db.select().from(settings).where(eq(settings.key, 'vat_bps'))
    expect(row!.value).toBe(500)
  })

  it('stores integration credentials flagged as secret', async () => {
    const [row] = await db.insert(settings)
      .values({ key: 'gateway_api_key', value: 'encrypted-blob', isSecret: true })
      .returning()
    expect(row!.isSecret).toBe(true)
  })

  it('rejects a duplicate setting key', async () => {
    await db.insert(settings).values({ key: 'company_trn', value: '100123456700003' })
    await expect(db.insert(settings).values({ key: 'company_trn', value: 'other' }))
      .rejects.toThrow(/duplicate key value/)
  })

  it('stores an editable legal page', async () => {
    const [page] = await db.insert(contentPages).values({
      slug: 'cancellation-policy', title: 'Cancellation Policy',
      body: 'Free cancellation up to 24 hours before pickup.', isLegal: true,
    }).returning()
    expect(page!.isLegal).toBe(true)
  })

  it('versions the rental agreement so a contract can be reproduced as accepted (FR-22.2)', async () => {
    await db.insert(termsVersions).values({
      version: 'v1.0', body: 'Rental agreement text v1.0', effectiveFrom: '2026-01-01',
    })
    await db.insert(termsVersions).values({
      version: 'v1.1', body: 'Rental agreement text v1.1', effectiveFrom: '2026-06-01',
    })
    const rows = await db.select().from(termsVersions)
    expect(rows).toHaveLength(2)
  })

  it('rejects a duplicate terms version', async () => {
    await db.insert(termsVersions).values({ version: 'v2.0', body: 'x', effectiveFrom: '2026-01-01' })
    await expect(
      db.insert(termsVersions).values({ version: 'v2.0', body: 'y', effectiveFrom: '2026-02-01' }),
    ).rejects.toThrow(/terms_versions_version_unique/)
  })

  it('refuses a booking pinning a terms version that does not exist (FR-22.2)', async () => {
    const f = await bookingFixtures()
    await expect(db.insert(bookings).values({
      reference: 'AA-2026-000090', customerId: f.customer.id, product: 'self_drive',
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-08-01T08:00:00Z'),
      endsAt: new Date('2026-08-03T08:00:00Z'),
      subtotalFils: 24000, vatFils: 1200, totalFils: 25200, depositFils: 100000,
      termsVersion: 'v99.0',
    })).rejects.toThrow(/bookings_terms_version_terms_versions_version_fk/)
  })

  it('accepts a booking pinning a terms version that exists (FR-22.2)', async () => {
    const f = await bookingFixtures()
    await db.insert(termsVersions).values({
      version: 'v1.0', body: 'Rental agreement text v1.0', effectiveFrom: '2026-01-01',
    })
    const [booking] = await db.insert(bookings).values({
      reference: 'AA-2026-000091', customerId: f.customer.id, product: 'self_drive',
      vehicleId: f.vehicle.id, rateCardId: f.card.id,
      startsAt: new Date('2026-08-01T08:00:00Z'),
      endsAt: new Date('2026-08-03T08:00:00Z'),
      subtotalFils: 24000, vatFils: 1200, totalFils: 25200, depositFils: 100000,
      termsVersion: 'v1.0',
    }).returning()
    expect(booking!.termsVersion).toBe('v1.0')

    const [reread] = await db.select().from(bookings).where(eq(bookings.id, booking!.id))
    expect(reread!.termsVersion).toBe('v1.0')
  })
})
