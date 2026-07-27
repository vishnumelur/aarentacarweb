import { pgTable, uuid, text, boolean, date, jsonb, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './identity'

// FR-18.5, FR-18.6 — VAT rate, company details, policies and integration
// credentials. `isSecret` is a UI hint only — it drives write-only display in the
// settings UI (mask the value, require re-entry to change it). It does NOT encrypt
// `value` at rest: nothing in this schema or migration set does. FR-18.6's "encrypted
// at rest" requirement for integration credentials is unimplemented and belongs to the
// settings UI work (P1.7) — do not read this comment as satisfying it.
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
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
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdate(() => new Date()),
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
