import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema } from '@aa/db'
import type { Clock } from './clock.js'
import { resolveSession, SESSION_COOKIE, type SessionUser, type UserRole } from './session.js'

/**
 * 401 means "we do not know who you are"; 403 means "we do, and you may not".
 * Collapsing them tells an attacker whether an endpoint exists.
 */
export class AuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

interface GuardDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** FR-11.1 — every protected route resolves the caller before doing anything else. */
export async function requireUser(deps: GuardDeps, request: Request): Promise<SessionUser> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (token === null) throw new AuthError(401, 'Not signed in')
  const session = await resolveSession(deps, token)
  if (session === null) throw new AuthError(401, 'Not signed in')
  return session
}

/** FR-11.1 — same as requireUser, plus a role check that fails closed (403, not silently allowed). */
export async function requireRole(
  deps: GuardDeps, request: Request, roles: readonly UserRole[],
): Promise<SessionUser> {
  const user = await requireUser(deps, request)
  if (!roles.includes(user.role)) {
    throw new AuthError(403, `Requires one of: ${roles.join(', ')}`)
  }
  return user
}
