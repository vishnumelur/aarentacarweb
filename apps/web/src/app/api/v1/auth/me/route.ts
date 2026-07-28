import { eq } from 'drizzle-orm'
import { users } from '@aa/db'
import { getAppDb } from '@/db'
import { systemClock } from '@/auth/clock'
import { requireUser, toResponse } from '@/auth/guard'

export async function GET(request: Request): Promise<Response> {
  const db = getAppDb()

  let session
  try {
    session = await requireUser({ db, clock: systemClock }, request)
  } catch (error) {
    const response = toResponse(error)
    if (response !== null) return response
    throw error
  }

  const [u] = await db.select({ phone: users.phone }).from(users)
    .where(eq(users.id, session.userId)).limit(1)

  return Response.json({
    userId: session.userId, role: session.role,
    fullName: session.fullName, branchId: session.branchId,
    phone: u?.phone ?? null,
  })
}
