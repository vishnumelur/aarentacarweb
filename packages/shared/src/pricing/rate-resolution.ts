/**
 * Resolves which pricing rules applied on a given date.
 *
 * Dates are `YYYY-MM-DD` strings, matching the database's `date` columns. String
 * comparison is correct for that format and avoids timezone drift entirely — a
 * Date object would reintroduce the very ambiguity we are trying to avoid.
 */

export interface RateCard {
  readonly id: string
  readonly classId: string
  readonly dailyRateFils: number
  readonly depositFils: number
  readonly includedKmPerDay: number
  readonly excessKmRateFils: number
  readonly validFrom: string
  readonly validTo: string | null
}

export interface WeeklyTier {
  readonly rateCardId: string
  readonly minDays: number
  readonly discountBps: number
}

export interface SeasonalRate {
  readonly classId: string
  readonly name: string
  readonly startsOn: string
  readonly endsOn: string
  readonly multiplierBps: number
  readonly priority: number
}

/**
 * The rate card in force on `onDate`. Both window boundaries are inclusive, and a
 * null `validTo` means open-ended. Where windows overlap — which the database permits
 * for historic cards — the one that became effective most recently wins.
 *
 * Returns null rather than falling back to any card: a missing rate is a configuration
 * error the caller must surface, not paper over with the wrong price.
 */
export function resolveRateCard(
  cards: readonly RateCard[],
  onDate: string,
): RateCard | null {
  const applicable = cards.filter(
    (c) => c.validFrom <= onDate && (c.validTo === null || c.validTo >= onDate),
  )
  if (applicable.length === 0) return null
  return applicable.reduce((best, c) => (c.validFrom > best.validFrom ? c : best))
}

/**
 * The seasonal rule in force on `onDate`. FR-17.2: overlaps resolve by explicit
 * priority, highest wins — never by array order or creation time.
 */
export function resolveSeasonalRate(
  rules: readonly SeasonalRate[],
  onDate: string,
): SeasonalRate | null {
  const applicable = rules.filter((r) => r.startsOn <= onDate && r.endsOn >= onDate)
  if (applicable.length === 0) return null
  return applicable.reduce((best, r) => (r.priority > best.priority ? r : best))
}

/**
 * The most generous tier the duration qualifies for. `minDays` is inclusive, so a
 * 7-day rental gets the 7-day tier.
 */
export function resolveWeeklyTier(
  tiers: readonly WeeklyTier[],
  days: number,
): WeeklyTier | null {
  const applicable = tiers.filter((t) => days >= t.minDays)
  if (applicable.length === 0) return null
  return applicable.reduce((best, t) => (t.minDays > best.minDays ? t : best))
}
