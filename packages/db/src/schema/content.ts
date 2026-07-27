import { pgTable, uuid, text, boolean, date, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './identity'

// FR-18.5, FR-18.6 — VAT rate, company details, policies and integration
// credentials. Secrets are write-only in the UI; `isSecret` drives that.
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// FR-22.1, FR-22.3 — editable without a deployment
export const contentPages = pgTable('content_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  metaDescription: text('meta_description'),
  isLegal: boolean('is_legal').notNull().default(false),
  isPublished: boolean('is_published').notNull().default(true),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// FR-22.2 — bookings.termsVersion pins one of these, so the contract can always
// be reproduced exactly as the customer accepted it.
export const termsVersions = pgTable('terms_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull().unique(),
  body: text('body').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('terms_versions_effective_idx').on(t.effectiveFrom)])
