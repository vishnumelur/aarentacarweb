import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users } from '@aa/db'
import {
  createSession, resolveSession, revokeSession, revokeAllForUser,
  SESSION_COOKIE, sessionCookieOptions,
} from '../src/auth/session.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
function at(iso: string): Clock { return () => new Date(iso) }

async function makeUser(role: 'customer' | 'staff', phone: string) {
  const [u] = await db.insert(users)
    .values({ phone, fullName: 'Test User', role }).returning()
  return u!
}

describe('sessions', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('issues an opaque token, not a JWT', async () => {
    const u = await makeUser('customer', '+971501111111')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'customer' })
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(token.split('.')).toHaveLength(1)
  })

  it('stores only a hash of the token, so a database leak yields no usable session', async () => {
    const u = await makeUser('customer', '+971502222222')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'customer' })
    const rows = await db.execute<{ token_hash: string }>(sql`SELECT token_hash FROM sessions`)
    expect(rows.rows[0]!.token_hash).not.toBe(token)
    expect(rows.rows[0]!.token_hash).toHaveLength(64)
  })

  it('resolves a valid token to its user', async () => {
    const u = await makeUser('customer', '+971503333333')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'customer' })
    const resolved = await resolveSession({ db, clock }, token)
    expect(resolved?.userId).toBe(u.id)
    expect(resolved?.role).toBe('customer')
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveSession({ db, clock: at('2026-08-01T10:00:00Z') }, 'nope')).toBeNull()
  })

  it('gives customers thirty days and staff twelve hours (FR-13.7)', async () => {
    const c = await makeUser('customer', '+971504444444')
    const s = await makeUser('staff', '+971505555555')
    const clock = at('2026-08-01T10:00:00Z')
    const cs = await createSession({ db, clock }, { userId: c.id, role: 'customer' })
    const ss = await createSession({ db, clock }, { userId: s.id, role: 'staff' })
    expect(cs.expiresAt.toISOString()).toBe('2026-08-31T10:00:00.000Z')
    expect(ss.expiresAt.toISOString()).toBe('2026-08-01T22:00:00.000Z')
  })

  it('refuses an expired session', async () => {
    const u = await makeUser('staff', '+971506666666')
    const { token } = await createSession({ db, clock: at('2026-08-01T10:00:00Z') },
      { userId: u.id, role: 'staff' })
    // One second past the twelve-hour window.
    expect(await resolveSession({ db, clock: at('2026-08-01T22:00:01Z') }, token)).toBeNull()
    // One second before it, still valid.
    expect(await resolveSession({ db, clock: at('2026-08-01T21:59:59Z') }, token)).not.toBeNull()
  })

  it('refuses a session belonging to a deactivated user', async () => {
    const u = await makeUser('staff', '+971507777777')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id))
    expect(await resolveSession({ db, clock }, token)).toBeNull()
  })

  it('revokes a single session', async () => {
    const u = await makeUser('customer', '+971508888888')
    const clock = at('2026-08-01T10:00:00Z')
    const { token } = await createSession({ db, clock }, { userId: u.id, role: 'customer' })
    await revokeSession({ db, clock }, token)
    expect(await resolveSession({ db, clock }, token)).toBeNull()
  })

  it('revokes every session for a user at once (FR-21.6)', async () => {
    const u = await makeUser('staff', '+971509999999')
    const clock = at('2026-08-01T10:00:00Z')
    const a = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    const b = await createSession({ db, clock }, { userId: u.id, role: 'staff' })
    await revokeAllForUser({ db, clock }, u.id)
    expect(await resolveSession({ db, clock }, a.token)).toBeNull()
    expect(await resolveSession({ db, clock }, b.token)).toBeNull()
  })

  describe('sessionCookieOptions', () => {
    const originalNodeEnv = process.env.NODE_ENV

    // `@types/node` types `NODE_ENV` as read-only on `ProcessEnv`, but this test
    // genuinely needs to set it to exercise both branches. Write through an
    // index-signature view rather than weakening what the test asserts.
    const env = process.env as Record<string, string | undefined>

    // Restores `NODE_ENV` to its exact original state — `delete` if it was absent,
    // an assignment if it had a value. Assigning `undefined` directly would coerce
    // to the string "undefined" rather than clearing the key, silently leaking
    // state into whichever test file runs next.
    function restore(key: string, value: string | undefined): void {
      if (value === undefined) delete env[key]
      else env[key] = value
    }

    afterEach(() => {
      restore('NODE_ENV', originalNodeEnv)
    })

    it('is HttpOnly, SameSite=Lax, and path "/" regardless of environment (NFR-3)', () => {
      const opts = sessionCookieOptions(new Date('2026-08-31T10:00:00Z'))
      expect(SESSION_COOKIE).toBe('aa_session')
      expect(opts.httpOnly).toBe(true)
      expect(opts.sameSite).toBe('lax')
      expect(opts.path).toBe('/')
    })

    it('is Secure in production (NFR-3)', () => {
      env.NODE_ENV = 'production'
      const opts = sessionCookieOptions(new Date('2026-08-31T10:00:00Z'))
      expect(opts.secure).toBe(true)
    })

    it('is not Secure outside production, so a plain http://localhost dev server keeps the cookie', () => {
      env.NODE_ENV = 'test'
      const opts = sessionCookieOptions(new Date('2026-08-31T10:00:00Z'))
      expect(opts.secure).toBe(false)
    })
  })
})
