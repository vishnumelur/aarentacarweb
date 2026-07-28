import { pgTable, uuid, text, integer, timestamp, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * FR-13.3 — a one-time code sent to a phone.
 *
 * Only the hash is stored. A database leak must not hand an attacker live codes, and
 * a code is short enough that storing it plainly is meaningfully worse than storing a
 * password. Several rows per phone are permitted so a resend does not collide; the
 * verifier takes the newest unconsumed one.
 */
export const phoneOtps = pgTable('phone_otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('phone_otps_phone_idx').on(t.phone, t.createdAt),
  index('phone_otps_expiry_idx').on(t.expiresAt),
  check('attempts_non_negative', sql`${t.attempts} >= 0`),
])
