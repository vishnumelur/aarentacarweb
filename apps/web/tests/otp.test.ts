import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { phoneOtps } from '@aa/db'
import { getAppDb } from '../src/db.js'
import { createRecordingDriver } from '../src/auth/notify.js'
import {
  requestOtp, verifyOtp, OTP_MAX_ATTEMPTS, OTP_IP_MAX_PER_WINDOW,
} from '../src/auth/otp.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const PHONE = '+971501234567'

function at(iso: string): Clock { return () => new Date(iso) }
function codeFrom(driver: ReturnType<typeof createRecordingDriver>): string {
  const body = driver.sent.at(-1)!.body
  return body.match(/(\d{6})/)![1]!
}
/** A distinct, validly-formatted UAE mobile number for each `i`. */
function phoneN(i: number): string {
  return `+97150${String(1_000_000 + i).padStart(7, '0')}`
}

describe('phone OTP', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE phone_otps RESTART IDENTITY CASCADE`)
  })

  it('sends a six-digit code to the number given', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') },
      { phone: PHONE, ipAddress: '94.200.1.1' })
    expect(r.ok).toBe(true)
    expect(notify.sent).toHaveLength(1)
    expect(notify.sent[0]!.to).toBe(PHONE)
    expect(notify.sent[0]!.channel).toBe('sms')
    expect(codeFrom(notify)).toMatch(/^\d{6}$/)
  })

  it('never returns the code to the caller', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    expect(JSON.stringify(r)).not.toContain(codeFrom(notify))
  })

  it('stores only a hash, never the code', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const rows = await db.execute<{ code_hash: string }>(sql`SELECT code_hash FROM phone_otps`)
    expect(rows.rows[0]!.code_hash).not.toBe(codeFrom(notify))
  })

  it('accepts the correct code', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const r = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(r.ok).toBe(true)
  })

  it('rejects a wrong code without consuming the OTP', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const bad = await verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })
    expect(bad).toEqual({ ok: false, reason: 'incorrect_code' })
    // The real code still works afterwards.
    const good = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(good.ok).toBe(true)
  })

  it('still accepts a code just under five minutes old (FR-13.3)', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const code = codeFrom(notify)
    // 4m59s later it still works.
    expect((await verifyOtp({ db, clock: at('2026-08-01T10:04:59Z') },
      { phone: PHONE, code })).ok).toBe(true)
  })

  it('refuses a code five minutes and one second old', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const r = await verifyOtp({ db, clock: at('2026-08-01T10:05:01Z') },
      { phone: PHONE, code: codeFrom(notify) })
    expect(r).toEqual({ ok: false, reason: 'expired' })
  })

  it('locks the code after five wrong attempts (FR-13.3)', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })
    }
    // Even the correct code is now refused.
    const r = await verifyOtp({ db, clock }, { phone: PHONE, code: codeFrom(notify) })
    expect(r).toEqual({ ok: false, reason: 'too_many_attempts' })
  })

  it('cannot reuse a consumed code', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const code = codeFrom(notify)
    expect((await verifyOtp({ db, clock }, { phone: PHONE, code })).ok).toBe(true)
    const again = await verifyOtp({ db, clock }, { phone: PHONE, code })
    expect(again).toEqual({ ok: false, reason: 'no_pending_code' })
  })

  it('rate-limits a resend within the cooldown', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const second = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:30Z') }, { phone: PHONE })
    expect(second).toEqual({ ok: false, reason: 'cooldown' })
    expect(notify.sent).toHaveLength(1)
  })

  it('permits a resend after the cooldown, and the newest code wins', async () => {
    const notify = createRecordingDriver()
    await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') }, { phone: PHONE })
    const first = codeFrom(notify)
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:01:01Z') }, { phone: PHONE })
    expect(r.ok).toBe(true)
    const second = codeFrom(notify)
    expect(second).not.toBe(first)
    const clock = at('2026-08-01T10:01:30Z')
    expect((await verifyOtp({ db, clock }, { phone: PHONE, code: second })).ok).toBe(true)
  })

  it('reports no pending code for a number that never requested one', async () => {
    const r = await verifyOtp({ db, clock: at('2026-08-01T10:00:00Z') },
      { phone: '+971500000000', code: '123456' })
    expect(r).toEqual({ ok: false, reason: 'no_pending_code' })
  })

  it('rejects a malformed phone number', async () => {
    const notify = createRecordingDriver()
    const r = await requestOtp({ db, notify, clock: at('2026-08-01T10:00:00Z') },
      { phone: 'not-a-number' })
    expect(r).toEqual({ ok: false, reason: 'invalid_phone' })
    expect(notify.sent).toHaveLength(0)
  })

  it('counts every concurrent wrong attempt exactly once, even under a race', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })

    const CONCURRENT = 4
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })),
    )

    const rows = await db.execute<{ attempts: number }>(
      sql`SELECT attempts FROM phone_otps WHERE phone = ${PHONE}`,
    )
    // A read-modify-write (`attempts: pending.attempts + 1`) loses updates under
    // concurrency: several requests read the same starting value and each writes
    // `start + 1`, so the counter undercounts. An atomic `attempts + 1` in SQL
    // does not, so this must equal exactly the number of concurrent calls made.
    expect(rows.rows[0]!.attempts).toBe(CONCURRENT)
  })

  it('lets exactly one concurrent verification of the correct code succeed', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const code = codeFrom(notify)

    const CONCURRENT = 10
    // Pre-warm the pool: opening a connection has setup latency that otherwise
    // serializes an initial burst (each call queues for its own fresh connection
    // rather than truly overlapping). Once every connection already exists, the
    // concurrent calls below dispatch their queries at essentially the same
    // instant, which is what actually exercises the race.
    await Promise.all(Array.from({ length: CONCURRENT }, () => db.execute(sql`SELECT 1`)))

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        verifyOtp({ db, clock }, { phone: PHONE, code })),
    )

    // Under READ COMMITTED, a plain SELECT does not block: every concurrent caller
    // can read `consumedAt IS NULL` before any of their UPDATEs commit, so an
    // unconditional `UPDATE ... SET consumedAt = now()` lets every one of them
    // "consume" the code and report success. Only a conditional
    // `UPDATE ... WHERE consumedAt IS NULL` — where the database, not a prior
    // read, decides who wins — can guarantee exactly one winner.
    const succeeded = results.filter((r) => r.ok)
    expect(succeeded).toHaveLength(1)
  })

  it('rate-limits concurrent resend requests for one number to a single SMS', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')

    const CONCURRENT = 8
    // See the comment in the verification race test above: pre-warm the pool so
    // the burst below genuinely overlaps rather than serializing on connection setup.
    await Promise.all(Array.from({ length: CONCURRENT }, () => db.execute(sql`SELECT 1`)))

    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        requestOtp({ db, notify, clock }, { phone: PHONE })),
    )

    // Two concurrent requests can each read "no recent row" before either has
    // committed its insert, so an unguarded check-then-insert lets every one of
    // them through the cooldown — double-billing the SMS provider and
    // double-texting the customer. Only one of these concurrent calls for the
    // same number, all at the same instant, should ever reach the notifier.
    expect(notify.sent).toHaveLength(1)
  })

  it('rate-limits OTP requests per IP across different phone numbers (FR-13.3)', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    const ip = '203.0.113.50'

    // Ten different numbers from the same IP, all inside one per-phone cooldown
    // window's worth of distinct phones — nothing here should be blocked by the
    // per-phone cooldown, only by the per-IP window.
    for (let i = 0; i < OTP_IP_MAX_PER_WINDOW; i++) {
      const r = await requestOtp({ db, notify, clock }, { phone: phoneN(i), ipAddress: ip })
      expect(r).toEqual({ ok: true })
    }

    // The eleventh request from the same IP, to an eleventh distinct number, is
    // refused — otherwise one IP could walk the entire UAE mobile number space at
    // unlimited rate, one paid SMS per attempt.
    const eleventh = await requestOtp(
      { db, notify, clock }, { phone: phoneN(OTP_IP_MAX_PER_WINDOW), ipAddress: ip },
    )
    expect(eleventh).toEqual({ ok: false, reason: 'ip_rate_limited' })
    expect(notify.sent).toHaveLength(OTP_IP_MAX_PER_WINDOW)

    // A different IP requesting a fresh number is unaffected.
    const otherIp = await requestOtp(
      { db, notify, clock },
      { phone: phoneN(OTP_IP_MAX_PER_WINDOW + 1), ipAddress: '198.51.100.7' },
    )
    expect(otherIp).toEqual({ ok: true })
  })

  it('does not rate-limit by IP when no IP address is given', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    for (let i = 0; i <= OTP_IP_MAX_PER_WINDOW; i++) {
      const r = await requestOtp({ db, notify, clock }, { phone: phoneN(i) })
      expect(r).toEqual({ ok: true })
    }
  })

  it('bounds concurrent wrong-code verification attempts to OTP_MAX_ATTEMPTS', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')
    await requestOtp({ db, notify, clock }, { phone: PHONE })
    const code = codeFrom(notify)

    const CONCURRENT = 10
    // Pre-warm the pool, as in the tests above — otherwise connection setup
    // latency serializes the burst and never exercises the race this proves closed.
    await Promise.all(Array.from({ length: CONCURRENT }, () => db.execute(sql`SELECT 1`)))

    // Ten concurrent *wrong*-code verifications, well over OTP_MAX_ATTEMPTS. Without
    // `SELECT ... FOR UPDATE` serializing these, every one of them would read the
    // same stale `attempts` and compare its guess against the hash before any
    // increment commits — the real ceiling on guesses tested would be attacker
    // concurrency, not the stored counter.
    await Promise.all(
      Array.from({ length: CONCURRENT }, () =>
        verifyOtp({ db, clock }, { phone: PHONE, code: '000000' })),
    )

    const rows = await db.execute<{ attempts: number }>(
      sql`SELECT attempts FROM phone_otps WHERE phone = ${PHONE}`,
    )
    expect(rows.rows[0]!.attempts).toBe(OTP_MAX_ATTEMPTS)

    // The correct code, tried afterwards, is refused: the lock ensured only
    // OTP_MAX_ATTEMPTS guesses were ever actually compared, and the code is now
    // locked out even against its own value.
    const r = await verifyOtp({ db, clock }, { phone: PHONE, code })
    expect(r).toEqual({ ok: false, reason: 'too_many_attempts' })
  })

  it('deletes phone_otps rows older than the retention window on the next request (PDPL)', async () => {
    const notify = createRecordingDriver()
    const clock = at('2026-08-01T10:00:00Z')

    // An old row, inserted directly, predating the one-day retention window.
    await db.insert(phoneOtps).values({
      phone: PHONE,
      codeHash: 'irrelevant-for-this-test',
      expiresAt: new Date('2026-07-30T10:10:00Z'),
      createdAt: new Date('2026-07-30T09:00:00Z'),
    })

    const before = await db.execute(sql`SELECT id FROM phone_otps WHERE phone = ${PHONE}`)
    expect(before.rows).toHaveLength(1)

    await requestOtp({ db, notify, clock }, { phone: PHONE })

    // Only the row `requestOtp` itself just inserted remains — the old one is gone.
    const after = await db.execute<{ created_at: string }>(
      sql`SELECT created_at FROM phone_otps WHERE phone = ${PHONE}`,
    )
    expect(after.rows).toHaveLength(1)
    expect(new Date(after.rows[0]!.created_at).toISOString()).toBe(clock().toISOString())
  })
})
