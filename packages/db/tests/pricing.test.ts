import { describe, it, expect, beforeEach } from 'vitest'
import { sql, desc } from 'drizzle-orm'
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
    // 30 Dec falls inside both windows — the higher priority must win.
    const contested = await db.select().from(seasonalRates)
      .where(sql`${seasonalRates.startsOn} <= '2026-12-30' AND ${seasonalRates.endsOn} >= '2026-12-30'`)
      .orderBy(desc(seasonalRates.priority))
      .limit(1)
    expect(contested[0]!.name).toBe('NYE')
    expect(contested[0]!.multiplierBps).toBe(18000)

    // 15 Nov falls only inside Peak.
    const uncontested = await db.select().from(seasonalRates)
      .where(sql`${seasonalRates.startsOn} <= '2026-11-15' AND ${seasonalRates.endsOn} >= '2026-11-15'`)
      .orderBy(desc(seasonalRates.priority))
      .limit(1)
    expect(uncontested[0]!.name).toBe('Peak')
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

  it('permits only one open-ended rate card per class (FR-17.7)', async () => {
    const cls = await seedClass()
    const base = {
      classId: cls.id, dailyRateFils: 15000, depositFils: 100000,
      includedKmPerDay: 250, excessKmRateFils: 50,
    }
    await db.insert(rateCards).values({ ...base, validFrom: '2026-01-01' })
    await expect(
      db.insert(rateCards).values({ ...base, validFrom: '2026-06-01' }),
    ).rejects.toThrow()
    // A closed-ended card alongside a current one is fine.
    await expect(
      db.insert(rateCards).values({ ...base, validFrom: '2025-01-01', validTo: '2025-12-31' }),
    ).resolves.toBeDefined()
  })

  it('scopes a promo code to specific products (FR-17.4)', async () => {
    const [promo] = await db.insert(promoCodes).values({
      code: 'SELFDRIVE20', discountType: 'percent', discountValue: 20,
      validFrom: '2026-01-01', validTo: '2026-12-31',
      applicableProducts: ['self_drive', 'lease'],
      minBookingValueFils: 0, totalUsageCap: 50, perCustomerCap: 1,
    }).returning()
    expect(promo!.applicableProducts).toEqual(['self_drive', 'lease'])

    const [global] = await db.insert(promoCodes).values({
      code: 'EVERYTHING5', discountType: 'percent', discountValue: 5,
      validFrom: '2026-01-01', validTo: '2026-12-31',
      minBookingValueFils: 0, totalUsageCap: 10, perCustomerCap: 1,
    }).returning()
    expect(global!.applicableProducts).toBeNull()
  })
})
