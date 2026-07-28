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

/**
 * The one cookie parser for the app. Previously duplicated (differently) in
 * `me/route.ts` and `logout/route.ts` — one hand-rolled copy was untested and the
 * three were not guaranteed to agree on cookie-parsing edge cases (empty values,
 * `=` inside a value, duplicate names). Exported so every route handler that reads
 * `SESSION_COOKIE` goes through this one implementation.
 */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/**
 * `x-forwarded-for` is a comma-separated list the client can put anything in — it is
 * only trustworthy at all when a reverse proxy the app trusts *overwrites* it (never
 * appends to whatever the client sent) before forwarding. Per the runbook, that proxy
 * is Caddy. Even then, take only the first entry: everything after it is whatever
 * the client itself supplied and Caddy simply appended to.
 */
export function clientIp(request: Request): string | undefined {
  const header = request.headers.get('x-forwarded-for')
  if (header === null) return undefined
  const first = header.split(',')[0]?.trim()
  return first !== undefined && first.length > 0 ? first : undefined
}

/**
 * Maps an `AuthError` to the `Response` it implies (401/403), so route handlers do
 * not each hand-write the same try/catch. Returns `null` for anything that is not an
 * `AuthError`, so callers can distinguish "handled" from "rethrow" — swallowing an
 * unrelated exception into a 401 would hide real bugs behind a misleading auth error.
 */
export function toResponse(error: unknown): Response | null {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status })
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
