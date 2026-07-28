import { eq } from 'drizzle-orm'
import { users } from '@aa/db'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { resolveSession, SESSION_COOKIE } from '@/auth/session'

function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

export async function GET(request: Request): Promise<Response> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token === null) return Response.json({ error: 'not signed in' }, { status: 401 })

  const db = getAppDb()
  const session = await resolveSession({ db, clock: systemClock }, token)
  if (session === null) return Response.json({ error: 'not signed in' }, { status: 401 })

  const [u] = await db.select({ phone: users.phone }).from(users)
    .where(eq(users.id, session.userId)).limit(1)

  return Response.json({
    userId: session.userId, role: session.role,
    fullName: session.fullName, branchId: session.branchId,
    phone: u?.phone ?? null,
  })
}
