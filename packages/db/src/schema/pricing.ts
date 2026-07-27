import {
  pgTable, pgEnum, uuid, text, integer, boolean, date, timestamp, check, index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { vehicleClasses } from './fleet'

export const addonPriceModel = pgEnum('addon_price_model', ['per_day', 'per_booking'])
export const discountType = pgEnum('discount_type', ['percent', 'fixed'])

// FR-17.7 — rate cards are versioned by validity window. A booking records the
// rateCardId that applied, so historic bookings never reprice.
export const rateCards = pgTable('rate_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'restrict' }),
  dailyRateFils: integer('daily_rate_fils').notNull(),
  monthlyRateFils: integer('monthly_rate_fils'),
  depositFils: integer('deposit_fils').notNull(),
  includedKmPerDay: integer('included_km_per_day').notNull(),
  excessKmRateFils: integer('excess_km_rate_fils').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('rate_cards_class_validity_idx').on(t.classId, t.validFrom),
  check('daily_rate_non_negative', sql`${t.dailyRateFils} >= 0`),
  check('deposit_non_negative', sql`${t.depositFils} >= 0`),
  check('validity_ordered', sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
])

// FR-2.2 — discount in basis points above a day threshold
export const weeklyTiers = pgTable('weekly_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  rateCardId: uuid('rate_card_id').notNull().references(() => rateCards.id, { onDelete: 'cascade' }),
  minDays: integer('min_days').notNull(),
  discountBps: integer('discount_bps').notNull(),
}, (t) => [
  index('weekly_tiers_card_idx').on(t.rateCardId, t.minDays),
  check('min_days_positive', sql`${t.minDays} > 0`),
  check('discount_bps_range', sql`${t.discountBps} BETWEEN 0 AND 10000`),
])

// FR-17.2 — overlapping rules resolve by priority, highest wins
export const seasonalRates = pgTable('seasonal_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id').notNull().references(() => vehicleClasses.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  multiplierBps: integer('multiplier_bps').notNull(),
  priority: integer('priority').notNull().default(0),
}, (t) => [
  index('seasonal_rates_class_range_idx').on(t.classId, t.startsOn, t.endsOn),
  check('range_ordered', sql`${t.endsOn} >= ${t.startsOn}`),
  check('multiplier_positive', sql`${t.multiplierBps} > 0`),
])

export const addons = pgTable('addons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  priceFils: integer('price_fils').notNull(),
  priceModel: addonPriceModel('price_model').notNull(),
  stockLimit: integer('stock_limit'),
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [check('addon_price_non_negative', sql`${t.priceFils} >= 0`)])

export const promoCodes = pgTable('promo_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  discountType: discountType('discount_type').notNull(),
  discountValue: integer('discount_value').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to').notNull(),
  minBookingValueFils: integer('min_booking_value_fils').notNull().default(0),
  totalUsageCap: integer('total_usage_cap'),
  perCustomerCap: integer('per_customer_cap').notNull().default(1),
  timesUsed: integer('times_used').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
}, (t) => [
  check('promo_range_ordered', sql`${t.validTo} >= ${t.validFrom}`),
  check('discount_value_positive', sql`${t.discountValue} > 0`),
])
