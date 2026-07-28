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
 * This makes the *increment* race-free — the stored counter can never read higher
 * than `OTP_MAX_ATTEMPTS`. It does NOT cap concurrent guesses, and callers (Task 7's
 * route handler in particular) must not read "attempts capped at 5" as "at most 5
 * guesses are ever tested." Every concurrent request reads the same "not yet
 * locked" `pending` row and evaluates `hashCode(input.code) !== pending.codeHash`
 * against it before any of their increments commit — nothing here blocks a second,
 * third, or Nth concurrent caller from testing its own guess against the hash while
 * the first caller's increment is still in flight. A burst of, say, 20 parallel
 * guesses all get compared against the hash even though `attempts` tops out at 5
 * once the dust settles, so this bounds brute-force *rate* (one wrong code costs one
 * of five sequential attempts) but not a concurrent brute-force *burst*. Closing
 * that gap needs the read and the conditional increment to happen as one atomic
 * step — e.g. `SELECT ... FOR UPDATE` on `pending` inside a transaction, so a second
 * concurrent caller blocks on the row lock until the first's attempt (and its
 * increment) has committed, rather than reading a stale, pre-increment `attempts`
 * concurrently. That row-level locking is a bigger change than this function
 * currently makes and is deliberately not implemented here.
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

  // Conditional, and the result is decided by the row count, not the prior SELECT:
  // under READ COMMITTED a plain SELECT never blocks, so several concurrent callers
  // can all read `consumedAt IS NULL` before any of their UPDATEs commit. An
  // unconditional `SET consumedAt = now()` would then let every one of them "win" —
  // each replaying the same code into its own session (Task 7 mints one session per
  // successful verification). Guarding the UPDATE on `consumedAt IS NULL` means only
  // the first commit actually changes the row; every later commit for the same
  // `id` matches zero rows and is told, correctly, that there was nothing left to
  // consume.
  const consumed = await deps.db.update(phoneOtps)
    .set({ consumedAt: now })
    .where(and(eq(phoneOtps.id, pending.id), isNull(phoneOtps.consumedAt)))
    .returning({ id: phoneOtps.id })

  // Exactly one caller wins the race. Everyone else sees zero rows: the code was
  // already consumed between our SELECT and our UPDATE, so this attempt is a replay.
  if (consumed.length === 0) return { ok: false, reason: 'no_pending_code' }
  return { ok: true }
}
