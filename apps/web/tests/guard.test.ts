import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users } from '@aa/db'
import { createSession, SESSION_COOKIE } from '../src/auth/session.js'
import {
  requireUser, requireRole, AuthError, readCookie, clientIp, toResponse,
} from '../src/auth/guard.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const clock: Clock = () => new Date('2026-08-01T10:00:00Z')

async function signedInAs(role: 'customer' | 'staff' | 'owner', phone: string) {
  const [u] = await db.insert(users).values({ phone, fullName: 'T', role }).returning()
  const { token } = await createSession({ db, clock }, { userId: u!.id, role })
  return new Request('http://localhost/x', { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
}

describe('role guards', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('rejects an anonymous request with 401', async () => {
    await expect(requireUser({ db, clock }, new Request('http://localhost/x')))
      .rejects.toMatchObject({ status: 401 })
  })

  it('accepts a signed-in user', async () => {
    const req = await signedInAs('customer', '+971501111111')
    const u = await requireUser({ db, clock }, req)
    expect(u.role).toBe('customer')
  })

  it('rejects a role that is not permitted with 403, not 401', async () => {
    const req = await signedInAs('customer', '+971502222222')
    await expect(requireRole({ db, clock }, req, ['staff', 'owner']))
      .rejects.toMatchObject({ status: 403 })
  })

  it('accepts a permitted role', async () => {
    const req = await signedInAs('staff', '+971503333333')
    const u = await requireRole({ db, clock }, req, ['staff', 'owner'])
    expect(u.role).toBe('staff')
  })

  it('distinguishes not-signed-in from not-allowed', async () => {
    const anon = requireRole({ db, clock }, new Request('http://localhost/x'), ['owner'])
    await expect(anon).rejects.toBeInstanceOf(AuthError)
    await expect(anon).rejects.toMatchObject({ status: 401 })
  })

  describe('readCookie', () => {
    it('reads a named cookie out of a header with several', () => {
      expect(readCookie('a=1; aa_session=tok123; b=2', SESSION_COOKIE)).toBe('tok123')
    })

    it('returns null when the header is absent or the cookie is not present', () => {
      expect(readCookie(null, SESSION_COOKIE)).toBeNull()
      expect(readCookie('a=1; b=2', SESSION_COOKIE)).toBeNull()
    })
  })

  describe('clientIp', () => {
    it('takes only the first entry of a comma-separated x-forwarded-for', () => {
      const req = new Request('http://localhost/x', {
        headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' },
      })
      expect(clientIp(req)).toBe('203.0.113.5')
    })

    it('returns undefined when the header is absent', () => {
      expect(clientIp(new Request('http://localhost/x'))).toBeUndefined()
    })
  })

  describe('toResponse', () => {
    it('maps an AuthError to a Response carrying its status', async () => {
      const response = toResponse(new AuthError(403, 'Requires one of: owner'))
      expect(response).not.toBeNull()
      expect(response!.status).toBe(403)
      expect((await response!.json()).error).toBe('Requires one of: owner')
    })

    it('returns null for anything that is not an AuthError, so it is not swallowed', () => {
      expect(toResponse(new Error('boom'))).toBeNull()
    })
  })
})
