import { describe, it, expect } from 'vitest'
import { quote, type QuoteInput, type Addon, type PromoCode } from '../src/pricing/quote.js'
import type { RateCard, WeeklyTier, SeasonalRate } from '../src/pricing/rate-resolution.js'

const CARD: RateCard = {
  id: 'card-1', classId: 'economy', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom: '2026-01-01', validTo: null,
}

const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  product: 'self_drive',
  classId: 'economy',
  startDate: '2026-08-01',
  endDate: '2026-08-03',
  rateCards: [CARD],
  weeklyTiers: [],
  seasonalRates: [],
  addons: [],
  promoCode: null,
  deliveryFeeFils: 0,
  oneWayFeeFils: 0,
  vatBps: 500,
  ...over,
})

describe('pricing quote', () => {
  it('prices a two-day rental at the daily rate', () => {
    const r = quote(base())
    expect(r.days).toBe(2)
    expect(r.baseFils).toBe(24000)
    expect(r.subtotalFils).toBe(24000)
    expect(r.discountFils).toBe(0)
    expect(r.vatFils).toBe(1200)
    expect(r.totalFils).toBe(25200)
    expect(r.depositFils).toBe(100000)
  })

  it('always satisfies the database totals_consistent constraint', () => {
    const cases: QuoteInput[] = [
      base(),
      base({ endDate: '2026-08-10', weeklyTiers: [{ rateCardId: 'card-1', minDays: 7, discountBps: 1500 }] }),
      base({ deliveryFeeFils: 5000, oneWayFeeFils: 3000 }),
      base({ promoCode: { code: 'X', discountType: 'percent', discountValue: 10, applicableProducts: null, minBookingValueFils: 0 } }),
      base({ addons: [{ id: 'a', slug: 'gps', priceFils: 2000, priceModel: 'per_day', quantity: 1 }] }),
    ]
    for (const input of cases) {
      const r = quote(input)
      expect(r.totalFils, JSON.stringify(input)).toBe(r.subtotalFils - r.discountFils + r.vatFils)
      expect(Number.isInteger(r.totalFils)).toBe(true)
    }
  })

  it('counts days inclusively of the start and exclusively of the end', () => {
    // 1 Aug 08:00 to 3 Aug 08:00 is two rental days.
    expect(quote(base()).days).toBe(2)
    expect(quote(base({ endDate: '2026-08-02' })).days).toBe(1)
    expect(quote(base({ endDate: '2026-08-08' })).days).toBe(7)
  })

  it('charges a minimum of one day', () => {
    expect(quote(base({ endDate: '2026-08-01' })).days).toBe(1)
  })

  it('applies a weekly tier once the duration qualifies (FR-2.2)', () => {
    const tiers: WeeklyTier[] = [{ rateCardId: 'card-1', minDays: 7, discountBps: 1500 }]
    const r = quote(base({ endDate: '2026-08-08', weeklyTiers: tiers }))
    expect(r.days).toBe(7)
    expect(r.baseFils).toBe(84000)
    expect(r.discountFils).toBe(12600)       // 15% of 84000
    expect(r.vatFils).toBe(3570)             // 5% of (84000 - 12600)
    expect(r.totalFils).toBe(74970)
  })

  it('applies a seasonal multiplier to the base rate (FR-2.3)', () => {
    const seasonal: SeasonalRate[] = [{
      classId: 'economy', name: 'Peak', startsOn: '2026-11-01', endsOn: '2027-03-31',
      multiplierBps: 13000, priority: 10,
    }]
    const r = quote(base({ startDate: '2026-11-10', endDate: '2026-11-12', seasonalRates: seasonal }))
    expect(r.baseFils).toBe(31200)           // 24000 * 1.3
    expect(r.seasonalName).toBe('Peak')
  })

  it('prices per-day and per-booking addons differently', () => {
    const addons: Addon[] = [
      { id: 'a1', slug: 'child-seat', priceFils: 3000, priceModel: 'per_day', quantity: 2 },
      { id: 'a2', slug: 'extra-driver', priceFils: 5000, priceModel: 'per_booking', quantity: 1 },
    ]
    const r = quote(base({ addons }))
    // child seat: 3000 * 2 seats * 2 days = 12000; extra driver: 5000 once
    expect(r.addonsFils).toBe(17000)
    expect(r.subtotalFils).toBe(41000)
  })

  it('includes delivery and one-way fees in the subtotal', () => {
    const r = quote(base({ deliveryFeeFils: 5000, oneWayFeeFils: 3000 }))
    expect(r.subtotalFils).toBe(32000)
    expect(r.vatFils).toBe(1600)
  })

  it('applies a percentage promo to the discounted subtotal', () => {
    const promo: PromoCode = {
      code: 'WELCOME10', discountType: 'percent', discountValue: 10,
      applicableProducts: null, minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(2400)        // 10% of 24000
    expect(r.totalFils).toBe(22680)          // 24000 - 2400 + 1080
  })

  it('applies a fixed promo capped at the subtotal', () => {
    const promo: PromoCode = {
      code: 'FLAT', discountType: 'fixed', discountValue: 999999,
      applicableProducts: null, minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(24000)       // never more than the subtotal
    expect(r.totalFils).toBe(0)
    expect(r.vatFils).toBe(0)
  })

  it('ignores a promo below its minimum booking value (FR-2.6)', () => {
    const promo: PromoCode = {
      code: 'BIG', discountType: 'percent', discountValue: 10,
      applicableProducts: null, minBookingValueFils: 50000,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(0)
    expect(r.promoRejectedReason).toBe('below_minimum_value')
  })

  it('ignores a promo scoped to other products (FR-17.4)', () => {
    const promo: PromoCode = {
      code: 'CHAUFFEUR', discountType: 'percent', discountValue: 20,
      applicableProducts: ['chauffeur_hourly'], minBookingValueFils: 0,
    }
    const r = quote(base({ promoCode: promo }))
    expect(r.discountFils).toBe(0)
    expect(r.promoRejectedReason).toBe('product_not_applicable')
  })

  it('never assumes 5% VAT — it uses what it is given', () => {
    expect(quote(base({ vatBps: 0 })).vatFils).toBe(0)
    expect(quote(base({ vatBps: 1000 })).vatFils).toBe(2400)
  })

  it('pins the rate card it used so the booking can record it (FR-17.7)', () => {
    expect(quote(base()).rateCardId).toBe('card-1')
  })

  it('throws when no rate card covers the start date rather than guessing', () => {
    expect(() => quote(base({ rateCards: [] }))).toThrow(/no rate card/i)
  })

  it('throws when the end date precedes the start date', () => {
    expect(() => quote(base({ startDate: '2026-08-10', endDate: '2026-08-01' })))
      .toThrow(/end date/i)
  })

  it('returns an itemised breakdown a customer could read', () => {
    const r = quote(base({
      addons: [{ id: 'a1', slug: 'gps', priceFils: 2000, priceModel: 'per_day', quantity: 1 }],
      deliveryFeeFils: 5000,
      promoCode: { code: 'WELCOME10', discountType: 'percent', discountValue: 10,
        applicableProducts: null, minBookingValueFils: 0 },
    }))
    const labels = r.lines.map((l) => l.label)
    expect(labels).toContain('Rental (2 days)')
    expect(labels).toContain('gps')
    expect(labels).toContain('Delivery')
    expect(labels).toContain('VAT')
    // Every line carries an integer amount.
    for (const l of r.lines) expect(Number.isInteger(l.amountFils)).toBe(true)

    const rentalLine = r.lines.find((l) => l.label === 'Rental (2 days)')
    expect(rentalLine?.amountFils).toBe(24000)

    const promoLine = r.lines.find((l) => l.label.startsWith('Promo'))
    expect(promoLine?.amountFils).toBeLessThan(0)
    expect(promoLine?.amountFils).toBe(-r.discountFils)
  })

  it('sums a weekly tier and a promo rather than compounding them', () => {
    const r = quote(base({
      endDate: '2026-08-08',
      weeklyTiers: [{ rateCardId: 'card-1', minDays: 7, discountBps: 1500 }],
      promoCode: { code: 'EXTRA20', discountType: 'percent', discountValue: 20,
        applicableProducts: null, minBookingValueFils: 0 },
    }))
    expect(r.days).toBe(7)
    expect(r.subtotalFils).toBe(84000)
    // Summed: 15% + 20% = 35% of 84000 = 29400.
    // Compounded would be 84000 * 0.85 * 0.80 = 57120, i.e. a 26880 discount.
    expect(r.discountFils).toBe(29400)
    expect(r.totalFils).toBe(r.subtotalFils - r.discountFils + r.vatFils)
  })

  it('rejects a percent promo above 100 instead of throwing', () => {
    const r = quote(base({
      promoCode: { code: 'BROKEN', discountType: 'percent', discountValue: 150,
        applicableProducts: null, minBookingValueFils: 0 },
    }))
    expect(r.discountFils).toBe(0)
    expect(r.promoRejectedReason).toBe('invalid_discount_value')
    expect(r.totalFils).toBe(r.subtotalFils - r.discountFils + r.vatFils)
  })

  it('caps a combined discount at the subtotal', () => {
    const r = quote(base({
      endDate: '2026-08-08',
      weeklyTiers: [{ rateCardId: 'card-1', minDays: 7, discountBps: 9000 }],
      promoCode: { code: 'HALF', discountType: 'percent', discountValue: 50,
        applicableProducts: null, minBookingValueFils: 0 },
    }))
    // 90% + 50% = 140%, which must clamp to exactly the subtotal, never beyond.
    expect(r.discountFils).toBe(r.subtotalFils)
    expect(r.totalFils).toBe(0)
    expect(r.vatFils).toBe(0)
  })
})
