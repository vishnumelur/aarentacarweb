import { createHash, randomInt } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema, phoneOtps } from '@aa/db'
import type { Clock } from './clock.js'
import type { NotificationDriver } from './notify.js'

export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** E.164, permissive about country but requiring the leading plus. */
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

export type RequestOtpReason = 'invalid_phone' | 'cooldown'
export type VerifyOtpReason =
  | 'no_pending_code' | 'expired' | 'incorrect_code' | 'too_many_attempts'

export type RequestOtpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: RequestOtpReason }

export type VerifyOtpResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VerifyOtpReason }

interface OtpDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}
interface RequestDeps extends OtpDeps {
  readonly notify: NotificationDriver
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Six digits, uniform, from a cryptographic source. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * FR-13.1, FR-13.3 — sends a one-time code to a phone number.
 *
 * The code is never returned to the caller and never stored in plaintext, so neither
 * an API response nor a database dump hands anyone a live code.
 */
export async function requestOtp(
  deps: RequestDeps,
  input: { readonly phone: string; readonly ipAddress?: string },
): Promise<RequestOtpResult> {
  if (!PHONE_PATTERN.test(input.phone)) return { ok: false, reason: 'invalid_phone' }

  const now = deps.clock()

  const [latest] = await deps.db.select().from(phoneOtps)
    .where(eq(phoneOtps.phone, input.phone))
    .orderBy(desc(phoneOtps.createdAt)).limit(1)

  if (latest !== undefined) {
    const since = (now.getTime() - latest.createdAt.getTime()) / 1000
    if (since < OTP_RESEND_COOLDOWN_SECONDS) return { ok: false, reason: 'cooldown' }
  }

  const code = generateCode()
  await deps.db.insert(phoneOtps).values({
    phone: input.phone,
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
    ipAddress: input.ipAddress ?? null,
    // Set explicitly from the injected clock rather than left to the column's
    // `defaultNow()`. The database would otherwise stamp the real wall-clock time,
    // and every cooldown/expiry comparison in this module reads `createdAt` back
    // against `deps.clock()` — a fixed test clock set to a date other than today
    // (as every test here does) would then compare a fake "now" against a real
    // insert time and get nonsense elapsed durations.
    createdAt: now,
  })

  await deps.notify.send({
    channel: 'sms',
    to: input.phone,
    body: `Your AA Rentals code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })

  return { ok: true }
}

/**
 * Verifies a code and consumes it on success. A wrong code increments the attempt
 * counter without consuming, so a typo does not force a resend — but five wrong
 * attempts lock the code even against the correct value.
 *
 * The attempt counter is incremented with an atomic `attempts + 1` in SQL rather
 * than a read-modify-write, and the update is filtered on `attempts < OTP_MAX_ATTEMPTS`
 * so the row is only touched — and the counter only advances — while a slot remains.
 * Concurrent verify calls on the same code therefore cannot together push the
 * counter past the limit: each `UPDATE ... WHERE attempts < N` either lands and
 * moves the count up by exactly one, or (once N rows have already landed) matches
 * zero rows and is a no-op. A plain `SET attempts = pending.attempts + 1` computed
 * in application code is a classic lost update — two requests can both read
 * `attempts = 4`, both write back `5`, and a brute-force attacker gets more guesses
 * than the limit allows.
 *
 * This makes the *increment* race-free. The remaining gap — several concurrent
 * requests each reading the same "not yet locked" `pending` row before any of
 * their increments commit, so more than one gets to test its guess against the
 * hash — would need the read and the conditional increment to happen as one
 * atomic step (e.g. a single `UPDATE ... RETURNING` that also carries the guess,
 * or `SELECT ... FOR UPDATE` inside a transaction) rather than a separate
 * `SELECT` followed by an `UPDATE`.
 */
export async function verifyOtp(
  deps: OtpDeps,
  input: { readonly phone: string; readonly code: string },
): Promise<VerifyOtpResult> {
  const now = deps.clock()

  const [pending] = await deps.db.select().from(phoneOtps)
    .where(and(eq(phoneOtps.phone, input.phone), isNull(phoneOtps.consumedAt)))
    .orderBy(desc(phoneOtps.createdAt)).limit(1)

  if (pending === undefined) return { ok: false, reason: 'no_pending_code' }
  if (pending.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
  if (pending.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

  if (hashCode(input.code) !== pending.codeHash) {
    // Atomic increment, guarded so it only applies while under the limit: the
    // database computes `attempts + 1` from the row it is holding, not from a
    // value the application read earlier and might be stale by the time this
    // statement runs.
    await deps.db.update(phoneOtps)
      .set({ attempts: sql`${phoneOtps.attempts} + 1` })
      .where(and(eq(phoneOtps.id, pending.id), sql`${phoneOtps.attempts} < ${OTP_MAX_ATTEMPTS}`))
    return { ok: false, reason: 'incorrect_code' }
  }

  await deps.db.update(phoneOtps)
    .set({ consumedAt: now })
    .where(eq(phoneOtps.id, pending.id))
  return { ok: true }
}
