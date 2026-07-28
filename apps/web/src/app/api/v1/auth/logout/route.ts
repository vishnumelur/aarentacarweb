import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { revokeSession, SESSION_COOKIE } from '@/auth/session'

export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get('cookie')
  const token = header
    ?.split(';').map((p) => p.trim().split('='))
    .find(([k]) => k === SESSION_COOKIE)?.[1] ?? null

  if (token !== null) {
    await revokeSession({ db: getAppDb(), clock: systemClock }, token)
  }
  return Response.json({ ok: true }, {
    status: 200,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` },
  })
}
