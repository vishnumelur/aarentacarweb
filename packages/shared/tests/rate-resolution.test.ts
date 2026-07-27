import { describe, it, expect } from 'vitest'
import {
  resolveRateCard, resolveSeasonalRate, resolveWeeklyTier,
  type RateCard, type SeasonalRate, type WeeklyTier,
} from '../src/pricing/rate-resolution.js'

const card = (id: string, validFrom: string, validTo: string | null): RateCard => ({
  id, classId: 'class-1', dailyRateFils: 12000, depositFils: 100000,
  includedKmPerDay: 250, excessKmRateFils: 50, validFrom, validTo,
})

describe('rate card resolution (FR-17.7)', () => {
  it('picks the open-ended current card', () => {
    const cards = [card('a', '2026-01-01', null)]
    expect(resolveRateCard(cards, '2026-08-01')?.id).toBe('a')
  })

  it('picks the historic card for a date inside its window', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31'), card('new', '2026-01-01', null)]
    expect(resolveRateCard(cards, '2025-06-15')?.id).toBe('old')
    expect(resolveRateCard(cards, '2026-06-15')?.id).toBe('new')
  })

  it('treats both window boundaries as inclusive', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31')]
    expect(resolveRateCard(cards, '2025-01-01')?.id).toBe('old')
    expect(resolveRateCard(cards, '2025-12-31')?.id).toBe('old')
    expect(resolveRateCard(cards, '2024-12-31')).toBeNull()
    expect(resolveRateCard(cards, '2026-01-01')).toBeNull()
  })

  it('returns null when no card covers the date rather than guessing', () => {
    expect(resolveRateCard([], '2026-08-01')).toBeNull()
    expect(resolveRateCard([card('a', '2027-01-01', null)], '2026-08-01')).toBeNull()
  })

  it('prefers the most recently effective card when windows overlap', () => {
    // The database permits historic overlaps; only one open-ended card is enforced.
    const cards = [card('older', '2026-01-01', '2026-12-31'), card('newer', '2026-06-01', '2026-12-31')]
    expect(resolveRateCard(cards, '2026-08-01')?.id).toBe('newer')
  })
})

describe('seasonal rule resolution (FR-17.2)', () => {
  const peak: SeasonalRate = {
    classId: 'class-1', name: 'Peak', startsOn: '2026-11-01', endsOn: '2027-03-31',
    multiplierBps: 13000, priority: 10,
  }
  const nye: SeasonalRate = {
    classId: 'class-1', name: 'NYE', startsOn: '2026-12-28', endsOn: '2027-01-02',
    multiplierBps: 18000, priority: 20,
  }

  it('applies the only rule covering the date', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-11-15')?.name).toBe('Peak')
  })

  it('resolves an overlap by explicit priority, highest wins', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-12-30')?.name).toBe('NYE')
    // Order of the input array must not matter.
    expect(resolveSeasonalRate([nye, peak], '2026-12-30')?.name).toBe('NYE')
  })

  it('returns null outside every window', () => {
    expect(resolveSeasonalRate([peak, nye], '2026-06-01')).toBeNull()
    expect(resolveSeasonalRate([], '2026-12-30')).toBeNull()
  })

  it('treats both boundaries as inclusive', () => {
    expect(resolveSeasonalRate([peak], '2026-11-01')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], '2027-03-31')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], '2027-04-01')).toBeNull()
  })
})

describe('weekly tier resolution (FR-2.2)', () => {
  const tiers: WeeklyTier[] = [
    { rateCardId: 'a', minDays: 7, discountBps: 1000 },
    { rateCardId: 'a', minDays: 14, discountBps: 1500 },
    { rateCardId: 'a', minDays: 30, discountBps: 2500 },
  ]

  it('applies no tier below the lowest threshold', () => {
    expect(resolveWeeklyTier(tiers, 1)).toBeNull()
    expect(resolveWeeklyTier(tiers, 6)).toBeNull()
  })

  it('applies a tier exactly at its threshold', () => {
    expect(resolveWeeklyTier(tiers, 7)?.discountBps).toBe(1000)
    expect(resolveWeeklyTier(tiers, 14)?.discountBps).toBe(1500)
  })

  it('applies the highest tier the duration qualifies for', () => {
    expect(resolveWeeklyTier(tiers, 13)?.discountBps).toBe(1000)
    expect(resolveWeeklyTier(tiers, 29)?.discountBps).toBe(1500)
    expect(resolveWeeklyTier(tiers, 60)?.discountBps).toBe(2500)
  })

  it('does not depend on input order', () => {
    const shuffled = [tiers[2]!, tiers[0]!, tiers[1]!]
    expect(resolveWeeklyTier(shuffled, 20)?.discountBps).toBe(1500)
  })

  it('returns null when there are no tiers', () => {
    expect(resolveWeeklyTier([], 30)).toBeNull()
  })
})
