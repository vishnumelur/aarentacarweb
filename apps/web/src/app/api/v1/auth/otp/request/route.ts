import { z } from 'zod'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { driverFromEnv } from '@/auth/notify'
import { requestOtp } from '@/auth/otp'
import { normalizeUaePhone } from '@/auth/phone'

const Body = z.object({ phone: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'phone is required' }, { status: 400 })
  }

  // Customers type local (0501234567) or country-code-without-plus
  // (971501234567) numbers far more often than full E.164 — normalise before
  // `requestOtp` sees it, since its PHONE_PATTERN only accepts E.164-with-plus.
  const phone = normalizeUaePhone(parsed.data.phone)
  if (phone === null) {
    return Response.json({ error: 'invalid_phone' }, { status: 400 })
  }

  const result = await requestOtp(
    { db: getAppDb(), notify: driverFromEnv(process.env.NOTIFY_DRIVER), clock: systemClock },
    { phone, ipAddress: request.headers.get('x-forwarded-for') ?? undefined },
  )

  if (!result.ok) {
    const status = result.reason === 'cooldown' ? 429 : 400
    return Response.json({ error: result.reason }, { status })
  }
  // Deliberately no code in the response.
  return Response.json({ sent: true })
}
