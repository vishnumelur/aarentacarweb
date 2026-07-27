import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, check, index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { bookings } from './booking'
import { customers } from './customer'
import { users } from './identity'

export const paymentMethod = pgEnum('payment_method', ['card', 'cash', 'bnpl'])
export const paymentStatus = pgEnum('payment_status', [
  'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded',
])
export const depositStatus = pgEnum('deposit_status', ['held', 'released', 'captured', 'expired'])
export const chargeType = pgEnum('charge_type', [
  'salik', 'fine', 'damage', 'late', 'fuel', 'cleaning', 'excess_km',
])
export const invoiceStatus = pgEnum('invoice_status', ['issued', 'paid', 'void', 'credited'])

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  method: paymentMethod('method').notNull(),
  status: paymentStatus('status').notNull().default('pending'),
  amountFils: integer('amount_fils').notNull(),
  refundedFils: integer('refunded_fils').notNull().default(0),
  // FR-4.5 — unique, so a replayed webhook cannot double-charge
  gatewayReference: text('gateway_reference').unique(),
  gatewayName: text('gateway_name'),
  receivedByUserId: uuid('received_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('payments_booking_idx').on(t.bookingId),
  check('amount_positive', sql`${t.amountFils} > 0`),
  check('refund_within_amount', sql`${t.refundedFils} BETWEEN 0 AND ${t.amountFils}`),
])

export const depositHolds = pgTable('deposit_holds', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  status: depositStatus('status').notNull().default('held'),
  amountFils: integer('amount_fils').notNull(),
  capturedFils: integer('captured_fils').notNull().default(0),
  gatewayReference: text('gateway_reference').unique(),
  heldAt: timestamp('held_at', { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
}, (t) => [
  index('deposit_holds_booking_idx').on(t.bookingId),
  check('hold_amount_positive', sql`${t.amountFils} > 0`),
  check('capture_within_hold', sql`${t.capturedFils} BETWEEN 0 AND ${t.amountFils}`),
])

export const charges = pgTable('charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  type: chargeType('type').notNull(),
  amountFils: integer('amount_fils').notNull(),
  adminFeeFils: integer('admin_fee_fils').notNull().default(0),
  description: text('description').notNull(),
  evidenceObjectKey: text('evidence_object_key'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  // FR-20.2 — a disputed charge is excluded from automatic deposit capture
  isDisputed: boolean('is_disputed').notNull().default(false),
  isSettled: boolean('is_settled').notNull().default(false),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('charges_booking_idx').on(t.bookingId),
  check('charge_amount_non_negative', sql`${t.amountFils} >= 0 AND ${t.adminFeeFils} >= 0`),
])

// FR-15.2 — `number` is a generated identity column, so numbering is gapless and
// monotonic. A void keeps its number; rows are never deleted.
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: integer('number').notNull().unique().generatedAlwaysAsIdentity({ startWith: 1 }),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  status: invoiceStatus('status').notNull().default('issued'),
  subtotalFils: integer('subtotal_fils').notNull(),
  vatFils: integer('vat_fils').notNull(),
  totalFils: integer('total_fils').notNull(),
  creditsInvoiceId: uuid('credits_invoice_id'),
  voidReason: text('void_reason'),
  pdfObjectKey: text('pdf_object_key'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('invoices_customer_idx').on(t.customerId),
  check('invoice_totals_non_negative', sql`
    ${t.subtotalFils} >= 0 AND ${t.vatFils} >= 0 AND ${t.totalFils} >= 0`),
  check('void_requires_reason', sql`${t.status} <> 'void' OR ${t.voidReason} IS NOT NULL`),
])
