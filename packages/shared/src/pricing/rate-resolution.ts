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
 * The rate card in force on `onDate` for the given `classId`. Both window boundaries are inclusive, and a
 * null `validTo` means open-ended. Where windows overlap — which the database permits
 * for historic cards — the one that became effective most recently wins.
 *
 * Dates must be well-formed `YYYY-MM-DD` strings, as they come from the database's `date`
 * columns; lexical comparison is only correct for that format.
 *
 * Returns null rather than falling back to any card: a missing rate is a configuration
 * error the caller must surface, not paper over with the wrong price.
 */
export function resolveRateCard(
  cards: readonly RateCard[],
  classId: string,
  onDate: string,
): RateCard | null {
  const applicable = cards.filter(
    (c) =>
      c.classId === classId &&
      c.validFrom <= onDate &&
      (c.validTo === null || c.validTo >= onDate),
  )
  if (applicable.length === 0) return null
  return applicable.reduce((best, c) => {
    if (c.validFrom !== best.validFrom) return c.validFrom > best.validFrom ? c : best
    // Same effective date: the open-ended card is the current one.
    const cOpen = c.validTo === null
    const bestOpen = best.validTo === null
    if (cOpen !== bestOpen) return cOpen ? c : best
    // Fully tied. Compare ids so the answer never depends on array order.
    return c.id > best.id ? c : best
  })
}

/**
 * The seasonal rule in force on `onDate` for the given `classId`. FR-17.2: overlaps resolve by explicit
 * priority, highest wins — never by array order or creation time. On equal priority, the narrower
 * window (more specific rule) wins.
 *
 * Dates must be well-formed `YYYY-MM-DD` strings, as they come from the database's `date`
 * columns; lexical comparison is only correct for that format.
 */
export function resolveSeasonalRate(
  rules: readonly SeasonalRate[],
  classId: string,
  onDate: string,
): SeasonalRate | null {
  const applicable = rules.filter(
    (r) => r.classId === classId && r.startsOn <= onDate && r.endsOn >= onDate,
  )
  if (applicable.length === 0) return null
  return applicable.reduce((best, r) => {
    if (r.priority !== best.priority) return r.priority > best.priority ? r : best
    const rSpan = Date.parse(r.endsOn) - Date.parse(r.startsOn)
    const bestSpan = Date.parse(best.endsOn) - Date.parse(best.startsOn)
    if (rSpan !== bestSpan) return rSpan < bestSpan ? r : best
    return r.name > best.name ? r : best
  })
}

/**
 * The most generous tier the duration qualifies for. `minDays` is inclusive, so a
 * 7-day rental gets the 7-day tier. On a tie, the larger discount wins.
 */
export function resolveWeeklyTier(
  tiers: readonly WeeklyTier[],
  days: number,
): WeeklyTier | null {
  const applicable = tiers.filter((t) => days >= t.minDays)
  if (applicable.length === 0) return null
  return applicable.reduce((best, t) => {
    if (t.minDays !== best.minDays) return t.minDays > best.minDays ? t : best
    return t.discountBps > best.discountBps ? t : best
  })
}
