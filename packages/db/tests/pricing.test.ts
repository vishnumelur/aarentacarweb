import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { vehicleClasses, rateCards, weeklyTiers, seasonalRates, addons, promoCodes } from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

async function seedClass() {
  const [cls] = await db.insert(vehicleClasses)
    .values({ name: 'Compact', slug: 'compact', displayOrder: 2 }).returning()
  return cls!
}

describe('pricing schema', () => {
  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE TABLE promo_codes, addons, seasonal_rates, weekly_tiers, rate_cards, vehicle_classes
      RESTART IDENTITY CASCADE`)
  })

  it('stores a rate card in fils with a validity window (FR-17.7)', async () => {
    const cls = await seedClass()
    const [card] = await db.insert(rateCards).values({
      classId: cls.id,
      dailyRateFils: 15000,
      depositFils: 100000,
      includedKmPerDay: 250,
      excessKmRateFils: 50,
      validFrom: '2026-01-01',
    }).returning()
    expect(card!.dailyRateFils).toBe(15000)
    expect(card!.validTo).toBeNull()
  })

  it('rejects a negative daily rate', async () => {
    const cls = await seedClass()
    await expect(db.insert(rateCards).values({
      classId: cls.id, dailyRateFils: -1, depositFils: 100000,
      includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01',
    })).rejects.toThrow()
  })

  it('stores weekly tiers as a discount above a day threshold', async () => {
    const cls = await seedClass()
    const [card] = await db.insert(rateCards).values({
      classId: cls.id, dailyRateFils: 15000, depositFils: 100000,
      includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01',
    }).returning()
    const [tier] = await db.insert(weeklyTiers).values({
      rateCardId: card!.id, minDays: 7, discountBps: 1500,
    }).returning()
    expect(tier!.discountBps).toBe(1500)
  })

  it('resolves overlapping seasonal rules by explicit priority (FR-17.2)', async () => {
    const cls = await seedClass()
    await db.insert(seasonalRates).values([
      { classId: cls.id, name: 'Peak', startsOn: '2026-11-01', endsOn: '2027-03-31', multiplierBps: 13000, priority: 10 },
      { classId: cls.id, name: 'NYE',  startsOn: '2026-12-28', endsOn: '2027-01-02', multiplierBps: 18000, priority: 20 },
    ])
    const rows = await db.select().from(seasonalRates).orderBy(sql`priority DESC`)
    expect(rows[0]!.name).toBe('NYE')
  })

  it('stores an addon with a price model and an optional stock limit', async () => {
    const [addon] = await db.insert(addons).values({
      name: 'Child seat', slug: 'child-seat', priceFils: 3000,
      priceModel: 'per_day', stockLimit: 12,
    }).returning()
    expect(addon!.priceModel).toBe('per_day')
  })

  it('stores a promo code with usage caps and rejects a duplicate code', async () => {
    await db.insert(promoCodes).values({
      code: 'WELCOME10', discountType: 'percent', discountValue: 10,
      validFrom: '2026-01-01', validTo: '2026-12-31',
      minBookingValueFils: 20000, totalUsageCap: 100, perCustomerCap: 1,
    })
    await expect(db.insert(promoCodes).values({
      code: 'WELCOME10', discountType: 'percent', discountValue: 5,
      validFrom: '2026-01-01', validTo: '2026-12-31',
      minBookingValueFils: 0, totalUsageCap: 10, perCustomerCap: 1,
    })).rejects.toThrow()
  })
})
