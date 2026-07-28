import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { requireUser, readCookie, toResponse } from '@/auth/guard'
import { revokeSession, SESSION_COOKIE } from '@/auth/session'

export async function POST(request: Request): Promise<Response> {
  const deps = { db: getAppDb(), clock: systemClock }

  try {
    await requireUser(deps, request)
  } catch (error) {
    const response = toResponse(error)
    if (response !== null) return response
    throw error
  }

  // requireUser already proved this cookie names a valid, unexpired session, so the
  // token is guaranteed present here — read via the same parser, not a second one.
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token !== null) {
    await revokeSession(deps, token)
  }

  return Response.json({ ok: true }, {
    status: 200,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  })
}
