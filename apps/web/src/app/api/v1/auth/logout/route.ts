import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { readCookie } from '@/auth/guard'
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from '@/auth/session'

export async function POST(request: Request): Promise<Response> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)

  // Deliberately NOT behind requireUser. Signing out is idempotent: an expired or
  // absent session must still clear the cookie and report success. Returning 401
  // here would leave a stale cookie in place at the exact moment the user asked to
  // be rid of it, and force every client to special-case an error that means
  // "already signed out". Clearing your own cookie is not a privileged operation —
  // there is nothing here for a guard to protect.
  if (token !== null) {
    await revokeSession({ db: getAppDb(), clock: systemClock }, token)
  }

  // The Secure flag on the clearing cookie must match whatever the login cookie was
  // actually set with, not just default off: a cookie set without Secure cannot
  // reliably overwrite/clear one set with Secure (browsers treat the two as
  // different storage slots keyed partly on that flag), so in production this must
  // carry Secure too or the stale, real session cookie survives "logout". Derived
  // from the same `sessionCookieOptions` the sign-in cookie was built from, rather
  // than a second hand-rolled `NODE_ENV` check that could drift from it — the
  // `expires` argument is irrelevant here since this cookie clears via Max-Age=0.
  const opts = sessionCookieOptions(new Date(0))
  const cookie =
    `${SESSION_COOKIE}=; Path=${opts.path}; Max-Age=0; ` +
    `HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`

  return Response.json({ ok: true }, { status: 200, headers: { 'set-cookie': cookie } })
}
