import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { POST as requestRoute } from '../src/app/api/v1/auth/otp/request/route.js'
import { POST as verifyRoute } from '../src/app/api/v1/auth/otp/verify/route.js'
import { GET as meRoute } from '../src/app/api/v1/auth/me/route.js'
import { POST as logoutRoute } from '../src/app/api/v1/auth/logout/route.js'

const db = getAppDb()
const PHONE = '+971501234567'

function post(url: string, body: unknown, cookie?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

/**
 * The console driver prints the code; capture it the way a developer would read it.
 *
 * The console line also contains the destination phone number (e.g.
 * `+971501234567`), which is itself a run of 12 consecutive digits. A naive
 * `/(\d{6})/` matches leftmost-first and greedily takes the phone's first six
 * digits ("971501") before ever reaching the actual code — deterministically
 * wrong for every code, on every run, for any phone number with a same or
 * longer digit run appearing first. The code is required to be an isolated
 * run of exactly six digits (bounded by non-digits on both sides), which the
 * phone's twelve-digit run never satisfies at any offset.
 */
function captureCode(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => { lines.push(args.join(' ')) }
  return fn().then(() => {
    console.info = original
    const match = lines.join('\n').match(/(?<!\d)(\d{6})(?!\d)/)
    if (!match) throw new Error(`no code found in console output:\n${lines.join('\n')}`)
    return match[1]!
  }).catch((e) => { console.info = original; throw e })
}

describe('auth routes', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE sessions, phone_otps, customers, users RESTART IDENTITY CASCADE`)
  })

  it('requests an OTP and returns 200 without leaking the code', async () => {
    let body: unknown
    const code = await captureCode(async () => {
      const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE }))
      expect(res.status).toBe(200)
      body = await res.json()
    })
    expect(JSON.stringify(body)).not.toContain(code)
  })

  it('rejects a malformed phone with 400', async () => {
    const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: 'nope' }))
    expect(res.status).toBe(400)
  })

  it('rejects a missing body with 400 rather than throwing', async () => {
    const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', {}))
    expect(res.status).toBe(400)
  })

  it('verifies the code, creates the account on first sign-in, and sets a cookie', async () => {
    const code = await captureCode(() =>
      requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('aa_session=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    // FR-13.4 — guest checkout creates a claimable account.
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*) FROM users WHERE phone=${PHONE}`)
    expect(Number(rows.rows[0]!.count)).toBe(1)
  })

  it('signs an existing customer in without creating a second account', async () => {
    for (const _ of [1, 2]) {
      const code = await captureCode(() =>
        requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
      const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
      expect(res.status).toBe(200)
      // Clear the cooldown so the second request is permitted.
      await db.execute(sql`UPDATE phone_otps SET created_at = created_at - interval '2 minutes'`)
    }
    const rows = await db.execute<{ count: string }>(sql`SELECT count(*) FROM users WHERE phone=${PHONE}`)
    expect(Number(rows.rows[0]!.count)).toBe(1)
  })

  it('refuses a wrong code with 401', async () => {
    await captureCode(() => requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify',
      { phone: PHONE, code: '000000' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 from /me without a session', async () => {
    const res = await meRoute(new Request('http://localhost/api/v1/auth/me'))
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user from /me', async () => {
    const code = await captureCode(() =>
      requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
    const verify = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
    const cookie = (verify.headers.get('set-cookie') ?? '').split(';')[0]!
    const res = await meRoute(new Request('http://localhost/api/v1/auth/me', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = await res.json() as { role: string; phone: string }
    expect(body.role).toBe('customer')
  })

  describe('phone normalisation', () => {
    it.each([
      ['+971501234567', 'full E.164'],
      ['971501234567', 'country code, no plus'],
      ['0501234567', 'local format'],
      ['+971 50 123 4567', 'E.164 with spaces'],
      ['050-123-4567', 'local format with dashes'],
      ['971-50-123-4567', 'country code with dashes'],
    ])('accepts %s (%s) and can be verified with the same form again', async (typed) => {
      const code = await captureCode(() =>
        requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: typed })))
      const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: typed, code }))
      expect(res.status).toBe(200)
      const rows = await db.execute<{ count: string }>(
        sql`SELECT count(*) FROM users WHERE phone=${PHONE}`,
      )
      expect(Number(rows.rows[0]!.count)).toBe(1)
    })

    it('rejects a number that is not a plausible UAE mobile after normalisation', async () => {
      const res = await requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: '+971211234567' }))
      expect(res.status).toBe(400)
    })
  })

  describe('logout', () => {
    async function signIn(): Promise<string> {
      const code = await captureCode(() =>
        requestRoute(post('http://localhost/api/v1/auth/otp/request', { phone: PHONE })))
      const res = await verifyRoute(post('http://localhost/api/v1/auth/otp/verify', { phone: PHONE, code }))
      return (res.headers.get('set-cookie') ?? '').split(';')[0]!
    }

    it('signs out and clears the cookie', async () => {
      const cookie = await signIn()

      const before = await db.execute<{ count: string }>(sql`SELECT count(*) FROM sessions`)
      expect(Number(before.rows[0]!.count)).toBe(1)

      const res = await logoutRoute(new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST', headers: { cookie },
      }))
      expect(res.status).toBe(200)

      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('aa_session=;')
      expect(setCookie).toContain('Max-Age=0')

      const after = await db.execute<{ count: string }>(sql`SELECT count(*) FROM sessions`)
      expect(Number(after.rows[0]!.count)).toBe(0)

      // The now-revoked session no longer authenticates.
      const me = await meRoute(new Request('http://localhost/api/v1/auth/me', { headers: { cookie } }))
      expect(me.status).toBe(401)
    })

    it('succeeds with no cookie at all', async () => {
      const res = await logoutRoute(new Request('http://localhost/api/v1/auth/logout', { method: 'POST' }))
      expect(res.status).toBe(200)
      expect((await res.json()).ok).toBe(true)
      // Sign-out is idempotent: even with nothing to revoke, the response still
      // carries the cookie-clearing header, so a client that calls this
      // defensively during error recovery always ends up with no cookie.
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('aa_session=;')
      expect(setCookie).toContain('Max-Age=0')
    })

    it('succeeds with an expired or unknown token, without throwing', async () => {
      const res = await logoutRoute(new Request('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        // Syntactically valid (base64url, long enough to look real) but not a
        // token any session was ever issued — revokeSession matches zero rows.
        headers: { cookie: `aa_session=${'a'.repeat(43)}` },
      }))
      expect(res.status).toBe(200)
      const setCookie = res.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('aa_session=;')
      expect(setCookie).toContain('Max-Age=0')
    })

    describe('Secure flag on the clearing cookie', () => {
      const originalNodeEnv = process.env.NODE_ENV
      // Same index-signature workaround session.test.ts uses: @types/node marks
      // NODE_ENV read-only, but this test genuinely needs to set it.
      const env = process.env as Record<string, string | undefined>

      afterEach(() => {
        if (originalNodeEnv === undefined) delete env.NODE_ENV
        else env.NODE_ENV = originalNodeEnv
      })

      it('is not Secure outside production, matching sessionCookieOptions', async () => {
        env.NODE_ENV = 'test'
        const res = await logoutRoute(new Request('http://localhost/api/v1/auth/logout', { method: 'POST' }))
        expect(res.headers.get('set-cookie') ?? '').not.toContain('Secure')
      })

      it('is Secure in production, matching sessionCookieOptions — otherwise a real, ' +
        'Secure-flagged session cookie would survive "logout"', async () => {
        env.NODE_ENV = 'production'
        const res = await logoutRoute(new Request('http://localhost/api/v1/auth/logout', { method: 'POST' }))
        expect(res.headers.get('set-cookie') ?? '').toContain('Secure')
      })
    })
  })
})
