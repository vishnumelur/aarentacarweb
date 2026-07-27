import { z } from 'zod'
import { addVat, applyBps, applyMultiplierBps } from '../money.js'
import {
  resolveRateCard, resolveSeasonalRate, resolveWeeklyTier,
  type RateCard, type SeasonalRate, type WeeklyTier,
} from './rate-resolution.js'
import {
  AddonSchema, BOOKING_PRODUCTS, PromoCodeSchema,
  type Addon, type BookingProduct, type PromoCode, type PromoRejectedReason, type QuoteLine,
} from './types.js'

export type { Addon, PromoCode, QuoteLine } from './types.js'

export interface QuoteInput {
  readonly product: BookingProduct
  readonly classId: string
  /** `YYYY-MM-DD`, inclusive. */
  readonly startDate: string
  /** `YYYY-MM-DD`, exclusive — the day the car comes back. */
  readonly endDate: string
  readonly rateCards: readonly RateCard[]
  readonly weeklyTiers: readonly WeeklyTier[]
  readonly seasonalRates: readonly SeasonalRate[]
  readonly addons: readonly Addon[]
  readonly promoCode: PromoCode | null
  readonly deliveryFeeFils: number
  readonly oneWayFeeFils: number
  /** Read from settings. Never assumed. */
  readonly vatBps: number
}

export interface QuoteResult {
  readonly days: number
  readonly rateCardId: string
  readonly seasonalName: string | null
  readonly weeklyDiscountBps: number
  readonly baseFils: number
  readonly addonsFils: number
  readonly deliveryFeeFils: number
  readonly oneWayFeeFils: number
  readonly subtotalFils: number
  readonly discountFils: number
  readonly vatFils: number
  readonly totalFils: number
  readonly depositFils: number
  readonly includedKmTotal: number
  readonly excessKmRateFils: number
  readonly promoRejectedReason: PromoRejectedReason | null
  readonly lines: readonly QuoteLine[]
}

// Mirrors the shapes from `./rate-resolution.js` (Task 3), which exports plain
// interfaces rather than Zod schemas. Duplicated here only for input validation
// at the API boundary — rate-resolution.ts itself is not modified.
const RateCardSchema = z.object({
  id: z.string(),
  classId: z.string(),
  dailyRateFils: z.number().int().nonnegative(),
  depositFils: z.number().int().nonnegative(),
  includedKmPerDay: z.number().int().nonnegative(),
  excessKmRateFils: z.number().int().nonnegative(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
})

const WeeklyTierSchema = z.object({
  rateCardId: z.string(),
  minDays: z.number().int().positive(),
  discountBps: z.number().int().nonnegative(),
})

const SeasonalRateSchema = z.object({
  classId: z.string(),
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  multiplierBps: z.number().int().nonnegative(),
  priority: z.number().int(),
})

/** Validates a `QuoteInput` shape at the API boundary before it reaches `quote()`. */
export const QuoteInputSchema = z.object({
  product: z.enum(BOOKING_PRODUCTS),
  classId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  rateCards: z.array(RateCardSchema),
  weeklyTiers: z.array(WeeklyTierSchema),
  seasonalRates: z.array(SeasonalRateSchema),
  addons: z.array(AddonSchema),
  promoCode: PromoCodeSchema.nullable(),
  deliveryFeeFils: z.number().int().nonnegative(),
  oneWayFeeFils: z.number().int().nonnegative(),
  vatBps: z.number().int().nonnegative(),
})

const MS_PER_DAY = 86_400_000

/** Whole days between two `YYYY-MM-DD` dates, minimum one. */
function rentalDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`Invalid date range: ${startDate} to ${endDate}`)
  }
  if (end < start) {
    throw new Error(`End date ${endDate} precedes start date ${startDate}`)
  }
  // Math.round guards against floating-point noise in the division; it is never
  // rounding a monetary value (UTC midnight-to-midnight differences are always
  // exact multiples of MS_PER_DAY, and Dubai has no DST), so this is date
  // arithmetic, not a rounding decision — it does not belong in money.ts.
  return Math.max(1, Math.round((end - start) / MS_PER_DAY))
}

/**
 * The single pricing calculation for the platform. Server, web and mobile all call
 * this, so a quote shown to a customer is the quote the server will charge.
 *
 * Order matters and is deliberate:
 *   base = daily rate x days, scaled by any seasonal multiplier
 *   subtotal = base + addons + delivery + one-way
 *   discount = weekly tier + promo, both applied to the subtotal, capped at it
 *   VAT = vatBps of (subtotal - discount)
 *   total = subtotal - discount + VAT
 *
 * That last line is exactly the database's `totals_consistent` CHECK. A quote that
 * cannot be persisted is a bug, so the shapes are kept identical on purpose.
 */
export function quote(input: QuoteInput): QuoteResult {
  const days = rentalDays(input.startDate, input.endDate)

  const card = resolveRateCard(input.rateCards, input.classId, input.startDate)
  if (card === null) {
    throw new Error(
      `No rate card covers ${input.startDate} for class ${input.classId}. ` +
      `This is a configuration error — refusing to guess a price.`,
    )
  }

  const seasonal = resolveSeasonalRate(input.seasonalRates, input.classId, input.startDate)
  const rawBase = card.dailyRateFils * days
  const baseFils = seasonal === null
    ? rawBase
    : applyMultiplierBps(rawBase, seasonal.multiplierBps)

  const addonsFils = input.addons.reduce((sum, a) => {
    const units = a.priceModel === 'per_day' ? a.quantity * days : a.quantity
    return sum + a.priceFils * units
  }, 0)

  const subtotalFils =
    baseFils + addonsFils + input.deliveryFeeFils + input.oneWayFeeFils

  const tier = resolveWeeklyTier(
    input.weeklyTiers.filter((t) => t.rateCardId === card.id),
    days,
  )
  const weeklyDiscountBps = tier?.discountBps ?? 0
  const weeklyDiscountFils = applyBps(subtotalFils, weeklyDiscountBps)

  let promoDiscountFils = 0
  let promoRejectedReason: PromoRejectedReason | null = null
  const promo = input.promoCode
  if (promo !== null) {
    if (promo.applicableProducts !== null &&
        !promo.applicableProducts.includes(input.product)) {
      promoRejectedReason = 'product_not_applicable'
    } else if (subtotalFils < promo.minBookingValueFils) {
      promoRejectedReason = 'below_minimum_value'
    } else if (promo.discountType === 'percent' && promo.discountValue > 100) {
      // The database permits any positive discount_value, so a 150% promo is storable.
      // Reject it the way every other bad promo is rejected rather than throwing —
      // one malformed row must not break pricing for every customer.
      promoRejectedReason = 'invalid_discount_value'
    } else {
      promoDiscountFils = promo.discountType === 'percent'
        ? applyBps(subtotalFils, promo.discountValue * 100)
        : promo.discountValue
    }
  }

  // A discount can never exceed what is being discounted — a negative total is not
  // a refund, it is a bug that would violate the database's non-negative CHECK.
  const discountFils = Math.min(subtotalFils, weeklyDiscountFils + promoDiscountFils)

  const netFils = subtotalFils - discountFils
  const vatFils = addVat(netFils, input.vatBps)
  const totalFils = netFils + vatFils

  const lines: QuoteLine[] = [{ label: `Rental (${days} days)`, amountFils: baseFils }]
  for (const a of input.addons) {
    const units = a.priceModel === 'per_day' ? a.quantity * days : a.quantity
    lines.push({ label: a.slug, amountFils: a.priceFils * units })
  }
  if (input.deliveryFeeFils > 0) {
    lines.push({ label: 'Delivery', amountFils: input.deliveryFeeFils })
  }
  if (input.oneWayFeeFils > 0) {
    lines.push({ label: 'One-way fee', amountFils: input.oneWayFeeFils })
  }
  if (weeklyDiscountFils > 0) {
    lines.push({ label: 'Long-rental discount', amountFils: -weeklyDiscountFils })
  }
  if (promoDiscountFils > 0) {
    lines.push({ label: `Promo ${promo?.code ?? ''}`.trim(), amountFils: -promoDiscountFils })
  }
  lines.push({ label: 'VAT', amountFils: vatFils })

  return {
    days,
    rateCardId: card.id,
    seasonalName: seasonal?.name ?? null,
    weeklyDiscountBps,
    baseFils,
    addonsFils,
    deliveryFeeFils: input.deliveryFeeFils,
    oneWayFeeFils: input.oneWayFeeFils,
    subtotalFils,
    discountFils,
    vatFils,
    totalFils,
    depositFils: card.depositFils,
    includedKmTotal: card.includedKmPerDay * days,
    excessKmRateFils: card.excessKmRateFils,
    promoRejectedReason,
    lines,
  }
}
