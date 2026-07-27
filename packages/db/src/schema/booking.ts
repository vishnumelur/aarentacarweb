import {
  pgTable, pgEnum, uuid, text, integer, timestamp, check, index, unique,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { customers } from './customer'
import { vehicles, branches } from './fleet'
import { rateCards, addons, promoCodes } from './pricing'
import { users } from './identity'
import { termsVersions } from './content'

// Spec §4 state machine. Chauffeur states are included now so the enum never
// needs altering in P2 — adding a value to a pg enum in a live migration is
// avoidable churn.
export const bookingStatus = pgEnum('booking_status', [
  'DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'DOCS_VERIFIED', 'READY_FOR_PICKUP',
  'OUT', 'RETURNED', 'CLOSING', 'COMPLETED',
  'CANCELLED', 'NO_SHOW', 'EXPIRED',
  'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_TRIP', 'DROPPED',
])

export const bookingProduct = pgEnum('booking_product', [
  'self_drive', 'lease', 'chauffeur_hourly', 'chauffeur_transfer',
])

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: text('reference').notNull().unique(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  product: bookingProduct('product').notNull(),
  status: bookingStatus('status').notNull().default('DRAFT'),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'restrict' }),
  // FR-17.7 — the rate card in force when the booking was made
  rateCardId: uuid('rate_card_id').notNull().references(() => rateCards.id, { onDelete: 'restrict' }),
  promoCodeId: uuid('promo_code_id').references(() => promoCodes.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  subtotalFils: integer('subtotal_fils').notNull(),
  discountFils: integer('discount_fils').notNull().default(0),
  vatFils: integer('vat_fils').notNull(),
  totalFils: integer('total_fils').notNull(),
  depositFils: integer('deposit_fils').notNull(),
  // FR-22.2 — pins the agreement in force at booking time so the contract can be
  // reproduced exactly as accepted. A foreign key, not a bare string: an unmatched
  // version silently defeats the guarantee, and only in a dispute.
  termsVersion: text('terms_version').references(() => termsVersions.version),
  cancellationPolicy: text('cancellation_policy'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('bookings_status_start_idx').on(t.status, t.startsAt),
  index('bookings_customer_idx').on(t.customerId),
  index('bookings_vehicle_range_idx').on(t.vehicleId, t.startsAt, t.endsAt),
  // FR-3.3 — the sweeper scans PENDING_PAYMENT bookings past their expiry. The
  // (status, startsAt) index does not serve that query.
  index('bookings_expiry_idx').on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`),
  check('range_ordered', sql`${t.endsAt} > ${t.startsAt}`),
  check('totals_non_negative', sql`
    ${t.subtotalFils} >= 0 AND ${t.vatFils} >= 0
    AND ${t.totalFils} >= 0 AND ${t.depositFils} >= 0`),
  // The money must add up. VAT applies to the discounted subtotal; the deposit is a
  // separate hold and is deliberately not part of the total. Without this, a pricing
  // bug persists self-inconsistent totals that no later reconciliation can detect.
  check('totals_consistent', sql`
    ${t.totalFils} = ${t.subtotalFils} - ${t.discountFils} + ${t.vatFils}`),
  // A self-drive booking without a vehicle is meaningless. Chauffeur bookings may
  // legitimately have none until dispatch assigns one.
  check('self_drive_needs_vehicle', sql`
    ${t.product} <> 'self_drive' OR ${t.vehicleId} IS NOT NULL`),
])

export const selfDriveDetails = pgTable('self_drive_details', {
  bookingId: uuid('booking_id').primaryKey()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  pickupBranchId: uuid('pickup_branch_id').notNull().references(() => branches.id),
  returnBranchId: uuid('return_branch_id').notNull().references(() => branches.id),
  includedKmTotal: integer('included_km_total').notNull(),
  deliveryAddress: text('delivery_address'),
  deliveryFeeFils: integer('delivery_fee_fils').notNull().default(0),
  oneWayFeeFils: integer('one_way_fee_fils').notNull().default(0),
})

export const bookingAddons = pgTable('booking_addons', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  addonId: uuid('addon_id').notNull().references(() => addons.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(1),
  // price captured at booking time, never re-read from the addon
  unitPriceFils: integer('unit_price_fils').notNull(),
  totalPriceFils: integer('total_price_fils').notNull(),
}, (t) => [
  unique('booking_addon_unique').on(t.bookingId, t.addonId),
  check('quantity_positive', sql`${t.quantity} > 0`),
])
