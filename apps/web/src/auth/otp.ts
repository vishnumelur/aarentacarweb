import { createHmac, randomInt } from 'node:crypto'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema, phoneOtps } from '@aa/db'
import type { Clock } from './clock.js'
import type { NotificationDriver } from './notify.js'

export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** FR-13.3 — per-IP window, distinct from the per-phone cooldown above. */
export const OTP_IP_WINDOW_MINUTES = 60
export const OTP_IP_MAX_PER_WINDOW = 10

/** PDPL retention: a phone number must not be kept in this table indefinitely. */
export const OTP_RETENTION_DAYS = 1

/** E.164, permissive about country but requiring the leading plus. */
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

export type RequestOtpReason = 'invalid_phone' | 'cooldown' | 'ip_rate_limited'
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

/**
 * The stored hash must be bound to something an attacker who has only read the
 * table does not also have. A raw `sha256(code)` is trivially reversible: the
 * code is six digits, so the entire space is 10^6, and a rainbow table inverts
 * every row in the table instantly — handing a database leak live, usable login
 * codes. HMAC with a server-side pepper (never persisted anywhere near this
 * table) closes that: inverting the hash now requires the pepper, not just
 * compute. The phone is folded into the HMAC input too, so two customers who
 * are ever issued the same six-digit code do not produce the same hash.
 */
function hashCode(phone: string, code: string): string {
  const pepper = process.env.OTP_PEPPER
  if (pepper === undefined || pepper.length < 32) {
    throw new Error('OTP_PEPPER must be set to at least 32 characters')
  }
  return createHmac('sha256', pepper).update(`${phone}:${code}`).digest('hex')
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
 *
 * The cooldown check-then-insert runs inside a transaction holding
 * `pg_advisory_xact_lock`, keyed by the phone number, for its whole duration. Without
 * this, two concurrent requests for the same number can each run the "is there a
 * recent row?" SELECT before either has committed its INSERT — both see no recent
 * row, both pass the cooldown, and the customer is double-texted (and the SMS
 * provider double-billed). A `SELECT ... FOR UPDATE` on the latest row would not
 * close this: there is nothing to lock yet on a phone's very first request, which is
 * exactly the case a burst of concurrent first-time requests hits. The advisory
 * lock serializes concurrent callers for the *same phone* regardless of whether a
 * row already exists, while callers for different phone numbers (a different lock
 * key) do not block one another.
 *
 * FR-13.3 also requires rate limiting *per IP*, not just per number: without it, one
 * IP can walk the entire UAE mobile number space at unlimited rate (one paid SMS per
 * attempt) or bomb a single number past the per-phone cooldown by waiting it out
 * mechanically. `phone_otps_ip_idx` exists for exactly this query. The window check
 * runs inside the same transaction as the per-phone advisory lock, so it shares that
 * lock's atomicity for a given phone — it does not itself hold a per-IP lock, so a
 * burst spread across many *different* phone numbers from one IP races this SELECT
 * the same way the pre-fix cooldown check raced (see the per-phone note above); a
 * concurrent burst could transiently land a few requests over the limit before the
 * count catches up. That is a materially smaller hole than "no limit at all" and is
 * accepted here — closing it fully would need a second advisory lock keyed by IP.
 *
 * When `ipAddress` is absent, this check is skipped entirely: there is nothing to
 * count against. An attacker who simply omits (or is allowed to spoof) the header
 * this rate limit reads is therefore invisible to it and falls back to being limited
 * only per-phone. See `guard.ts`'s `clientIp` for why this is trustworthy only
 * behind a proxy that overwrites the header rather than appending to it.
 */
export async function requestOtp(
  deps: RequestDeps,
  input: { readonly phone: string; readonly ipAddress?: string },
): Promise<RequestOtpResult> {
  if (!PHONE_PATTERN.test(input.phone)) return { ok: false, reason: 'invalid_phone' }

  const now = deps.clock()
  const code = generateCode()

  const outcome = await deps.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.phone}))`)

    // PDPL retention: phone_otps must not keep phone numbers indefinitely. Deleted
    // here, inside the transaction that already holds the per-phone lock, so no
    // separate job runner is needed. Compared against the injected clock, not
    // Postgres `now()` — every other date computation in this module reads
    // `deps.clock()` so a fixed test clock produces consistent results, and a raw
    // SQL `now()` here would silently reintroduce the real wall clock.
    await tx.delete(phoneOtps).where(and(
      eq(phoneOtps.phone, input.phone),
      lt(phoneOtps.createdAt, new Date(now.getTime() - OTP_RETENTION_DAYS * 24 * 60 * 60_000)),
    ))

    if (input.ipAddress !== undefined) {
      const windowStart = new Date(now.getTime() - OTP_IP_WINDOW_MINUTES * 60_000)
      const counted = await tx.select({ count: sql<number>`count(*)::int` })
        .from(phoneOtps)
        .where(and(
          eq(phoneOtps.ipAddress, input.ipAddress),
          sql`${phoneOtps.createdAt} >= ${windowStart}`,
        ))
      const count = counted[0]?.count ?? 0
      if (count >= OTP_IP_MAX_PER_WINDOW) {
        return { ok: false, reason: 'ip_rate_limited' } as const
      }
    }

    const [latest] = await tx.select().from(phoneOtps)
      .where(eq(phoneOtps.phone, input.phone))
      .orderBy(desc(phoneOtps.createdAt)).limit(1)

    if (latest !== undefined) {
      const since = (now.getTime() - latest.createdAt.getTime()) / 1000
      if (since < OTP_RESEND_COOLDOWN_SECONDS) {
        return { ok: false, reason: 'cooldown' } as const
      }
    }

    await tx.insert(phoneOtps).values({
      phone: input.phone,
      codeHash: hashCode(input.phone, code),
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

    return { ok: true } as const
  })

  if (!outcome.ok) return outcome

  // Sent after the transaction commits, and outside the lock: the lock only needs
  // to cover the decide-and-write step, not the network call to the SMS provider.
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
 * The whole function runs inside a transaction that takes `SELECT ... FOR UPDATE`
 * on the pending row before reading `attempts` or comparing the hash. Without this,
 * the stored `attempts` counter caps at `OTP_MAX_ATTEMPTS` but the real ceiling on
 * *guesses tested* is attacker concurrency: every concurrent caller reads the same
 * "not yet locked" row and compares its own guess against `codeHash` before any
 * increment commits, so a burst of (say) 20 parallel guesses all get compared even
 * though the counter tops out at 5 once the dust settles. `FOR UPDATE` closes this
 * by making a second concurrent caller block on the row lock until the first
 * caller's read-compare-increment has committed, so the Nth caller sees the
 * updated `attempts` (and, once it is at the limit, refuses the guess with
 * `too_many_attempts` before ever touching `hashCode`) rather than racing against a
 * stale read. This is the same shape `requestOtp` already uses for its per-phone
 * cooldown, applied to a row that (unlike a phone's first-ever OTP request) is
 * guaranteed to already exist by the time verification starts.
 *
 * The attempt counter is still incremented with an atomic `attempts + 1` in SQL,
 * guarded by `attempts < OTP_MAX_ATTEMPTS`, as defence in depth: correct on its own
 * even without the row lock above, so a lost update never inflates the guess
 * ceiling even if this function's locking is ever weakened.
 */
export async function verifyOtp(
  deps: OtpDeps,
  input: { readonly phone: string; readonly code: string },
): Promise<VerifyOtpResult> {
  const now = deps.clock()

  return deps.db.transaction(async (tx) => {
    const [pending] = await tx.select().from(phoneOtps)
      .where(and(eq(phoneOtps.phone, input.phone), isNull(phoneOtps.consumedAt)))
      .orderBy(desc(phoneOtps.createdAt)).limit(1)
      .for('update')

    if (pending === undefined) return { ok: false, reason: 'no_pending_code' }
    if (pending.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
    if (pending.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }

    if (hashCode(input.phone, input.code) !== pending.codeHash) {
      // Atomic increment, guarded so it only applies while under the limit: the
      // database computes `attempts + 1` from the row it is holding, not from a
      // value the application read earlier and might be stale by the time this
      // statement runs.
      await tx.update(phoneOtps)
        .set({ attempts: sql`${phoneOtps.attempts} + 1` })
        .where(and(eq(phoneOtps.id, pending.id), sql`${phoneOtps.attempts} < ${OTP_MAX_ATTEMPTS}`))
      return { ok: false, reason: 'incorrect_code' }
    }

    // Conditional, and the result is decided by the row count, not the prior SELECT.
    // Redundant with the row lock above under normal operation, but kept as
    // defence in depth: if it ever fires, the guard on `consumedAt IS NULL` still
    // means only the first commit for this `id` can change the row.
    const consumed = await tx.update(phoneOtps)
      .set({ consumedAt: now })
      .where(and(eq(phoneOtps.id, pending.id), isNull(phoneOtps.consumedAt)))
      .returning({ id: phoneOtps.id })

    // Exactly one caller wins the race. Everyone else sees zero rows: the code was
    // already consumed between our SELECT and our UPDATE, so this attempt is a replay.
    if (consumed.length === 0) return { ok: false, reason: 'no_pending_code' }
    return { ok: true }
  })
}
