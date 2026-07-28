import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { users, customers } from '@aa/db'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { clientIp } from '@/auth/guard'
import { verifyOtp } from '@/auth/otp'
import { createSession, SESSION_COOKIE, sessionCookieOptions } from '@/auth/session'
import { normalizeUaePhone } from '@/auth/phone'

const Body = z.object({ phone: z.string().min(1), code: z.string().length(6) })

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'phone and code are required' }, { status: 400 })

  // Must agree with the request route's normalisation, or a customer who typed
  // a local-format number to request a code could never verify it.
  const phone = normalizeUaePhone(parsed.data.phone)
  if (phone === null) return Response.json({ error: 'invalid_phone' }, { status: 400 })

  const db = getAppDb()
  const result = await verifyOtp({ db, clock: systemClock }, { phone, code: parsed.data.code })
  if (!result.ok) {
    const status = result.reason === 'too_many_attempts' ? 429 : 401
    return Response.json({ error: result.reason }, { status })
  }

  // FR-13.4 — first sign-in creates a claimable customer account.
  let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1)
  if (user === undefined) {
    ;[user] = await db.insert(users)
      .values({ phone, fullName: '', role: 'customer' }).returning()
    await db.insert(customers).values({ userId: user!.id }).onConflictDoNothing()
  }

  const { token, expiresAt } = await createSession(
    { db, clock: systemClock },
    {
      userId: user!.id,
      role: user!.role,
      ipAddress: clientIp(request),
      userAgent: request.headers.get('user-agent') ?? undefined,
    },
  )

  const opts = sessionCookieOptions(expiresAt)
  const cookie =
    `${SESSION_COOKIE}=${token}; Path=${opts.path}; Expires=${opts.expires.toUTCString()}; ` +
    `HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`

  return Response.json({ ok: true }, { status: 200, headers: { 'set-cookie': cookie } })
}
