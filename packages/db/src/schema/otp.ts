import { pgTable, uuid, text, integer, timestamp, check, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * FR-13.3 — a one-time code sent to a phone.
 *
 * Only a hash is stored, and it is not a plain `sha256(code)`. A six-digit code has
 * a keyspace of only 10^6, so an unsalted, unpeppered hash is a rainbow-table lookup
 * away from the plaintext — a database leak would hand an attacker every live code
 * in this table. `codeHash` (see `apps/web/src/auth/otp.ts`'s `hashCode`) is an
 * HMAC-SHA256 over `phone:code` keyed by a server-side pepper (`OTP_PEPPER`) that is
 * never stored anywhere near this table, so recovering a code from a leaked row also
 * requires the pepper, not just compute. Several rows per phone are permitted so a
 * resend does not collide; the verifier takes the newest unconsumed one. Rows older
 * than `OTP_RETENTION_DAYS` are deleted by `requestOtp` itself (PDPL retention), so
 * phone numbers do not accumulate here indefinitely.
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
  // FR-13.3 requires rate limiting per IP as well as per number. Queried by
  // `requestOtp`'s per-IP window check (`apps/web/src/auth/otp.ts`) — without this
  // index that query would scan a table that only grows.
  index('phone_otps_ip_idx').on(t.ipAddress, t.createdAt),
  check('attempts_non_negative', sql`${t.attempts} >= 0`),
])
