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
    expect(resolveRateCard(cards, 'class-1', '2026-08-01')?.id).toBe('a')
  })

  it('picks the historic card for a date inside its window', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31'), card('new', '2026-01-01', null)]
    expect(resolveRateCard(cards, 'class-1', '2025-06-15')?.id).toBe('old')
    expect(resolveRateCard(cards, 'class-1', '2026-06-15')?.id).toBe('new')
  })

  it('treats both window boundaries as inclusive', () => {
    const cards = [card('old', '2025-01-01', '2025-12-31')]
    expect(resolveRateCard(cards, 'class-1', '2025-01-01')?.id).toBe('old')
    expect(resolveRateCard(cards, 'class-1', '2025-12-31')?.id).toBe('old')
    expect(resolveRateCard(cards, 'class-1', '2024-12-31')).toBeNull()
    expect(resolveRateCard(cards, 'class-1', '2026-01-01')).toBeNull()
  })

  it('returns null when no card covers the date rather than guessing', () => {
    expect(resolveRateCard([], 'class-1', '2026-08-01')).toBeNull()
    expect(resolveRateCard([card('a', '2027-01-01', null)], 'class-1', '2026-08-01')).toBeNull()
  })

  it('prefers the most recently effective card when windows overlap', () => {
    // The database permits historic overlaps; only one open-ended card is enforced.
    const cards = [card('older', '2026-01-01', '2026-12-31'), card('newer', '2026-06-01', '2026-12-31')]
    expect(resolveRateCard(cards, 'class-1', '2026-08-01')?.id).toBe('newer')
  })

  it('breaks a rate card tie deterministically regardless of array order', () => {
    const openEnded = card('open', '2026-01-01', null)
    const closed = card('closed', '2026-01-01', '2026-12-31')
    // Identical validFrom. The open-ended card is the current one and must win either way.
    expect(resolveRateCard([openEnded, closed], 'class-1', '2026-06-01')?.id).toBe('open')
    expect(resolveRateCard([closed, openEnded], 'class-1', '2026-06-01')?.id).toBe('open')
  })

  it('never returns a rate card belonging to another vehicle class', () => {
    const economy = { ...card('eco', '2026-01-01', null), classId: 'economy' }
    const sports = { ...card('sports', '2026-01-01', null), classId: 'sports' }
    expect(resolveRateCard([economy, sports], 'economy', '2026-06-01')?.id).toBe('eco')
    expect(resolveRateCard([economy, sports], 'sports', '2026-06-01')?.id).toBe('sports')
    expect(resolveRateCard([economy, sports], 'luxury', '2026-06-01')).toBeNull()
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
    expect(resolveSeasonalRate([peak, nye], 'class-1', '2026-11-15')?.name).toBe('Peak')
  })

  it('resolves an overlap by explicit priority, highest wins', () => {
    expect(resolveSeasonalRate([peak, nye], 'class-1', '2026-12-30')?.name).toBe('NYE')
    // Order of the input array must not matter.
    expect(resolveSeasonalRate([nye, peak], 'class-1', '2026-12-30')?.name).toBe('NYE')
  })

  it('returns null outside every window', () => {
    expect(resolveSeasonalRate([peak, nye], 'class-1', '2026-06-01')).toBeNull()
    expect(resolveSeasonalRate([], 'class-1', '2026-12-30')).toBeNull()
  })

  it('treats both boundaries as inclusive', () => {
    expect(resolveSeasonalRate([peak], 'class-1', '2026-11-01')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], 'class-1', '2027-03-31')?.name).toBe('Peak')
    expect(resolveSeasonalRate([peak], 'class-1', '2027-04-01')).toBeNull()
  })

  it('breaks a seasonal priority tie by the narrower window, order-independently', () => {
    const broad: SeasonalRate = {
      classId: 'class-1', name: 'Broad', startsOn: '2026-01-01', endsOn: '2026-12-31',
      multiplierBps: 12000, priority: 10,
    }
    const narrow: SeasonalRate = {
      classId: 'class-1', name: 'Narrow', startsOn: '2026-06-01', endsOn: '2026-06-07',
      multiplierBps: 15000, priority: 10,
    }
    expect(resolveSeasonalRate([broad, narrow], 'class-1', '2026-06-03')?.name).toBe('Narrow')
    expect(resolveSeasonalRate([narrow, broad], 'class-1', '2026-06-03')?.name).toBe('Narrow')
  })

  it('never returns a seasonal rule belonging to another vehicle class', () => {
    const eco: SeasonalRate = {
      classId: 'economy', name: 'EcoPeak', startsOn: '2026-11-01', endsOn: '2027-03-31',
      multiplierBps: 12000, priority: 10,
    }
    const sports: SeasonalRate = {
      classId: 'sports', name: 'SportsPeak', startsOn: '2026-11-01', endsOn: '2027-03-31',
      multiplierBps: 20000, priority: 10,
    }
    expect(resolveSeasonalRate([eco, sports], 'economy', '2026-12-01')?.name).toBe('EcoPeak')
    expect(resolveSeasonalRate([eco, sports], 'sports', '2026-12-01')?.name).toBe('SportsPeak')
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

  it('breaks a weekly tier tie by the larger discount', () => {
    const tied: WeeklyTier[] = [
      { rateCardId: 'a', minDays: 7, discountBps: 1000 },
      { rateCardId: 'a', minDays: 7, discountBps: 1500 },
    ]
    expect(resolveWeeklyTier(tied, 10)?.discountBps).toBe(1500)
    expect(resolveWeeklyTier([tied[1]!, tied[0]!], 10)?.discountBps).toBe(1500)
  })
})
