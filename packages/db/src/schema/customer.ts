import { pgTable, pgEnum, uuid, text, boolean, date, timestamp, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './identity'

export const documentType = pgEnum('document_type', [
  'emirates_id', 'passport', 'visa', 'licence', 'idp',
])
export const documentStatus = pgEnum('document_status', ['pending', 'approved', 'rejected'])

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'restrict' }),
  nationality: text('nationality'),
  dateOfBirth: date('date_of_birth'),
  // FR-14.2 — blacklisting always carries a reason
  isBlacklisted: boolean('is_blacklisted').notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  blacklistedByUserId: uuid('blacklisted_by_user_id').references(() => users.id),
  // FR-14.4 — never shown to the customer
  internalNotes: text('internal_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('blacklist_requires_reason', sql`
    ${t.isBlacklisted} = false OR ${t.blacklistReason} IS NOT NULL
  `),
])

export const customerDocuments = pgTable('customer_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  type: documentType('type').notNull(),
  documentNumber: text('document_number'),
  expiresOn: date('expires_on').notNull(),
  objectKey: text('object_key').notNull(),
  status: documentStatus('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('customer_documents_customer_idx').on(t.customerId),
  index('customer_documents_expiry_idx').on(t.expiresOn),
  check('rejection_requires_reason', sql`
    ${t.status} <> 'rejected' OR ${t.rejectionReason} IS NOT NULL
  `),
])
