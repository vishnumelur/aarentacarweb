import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema, sessions, users } from '@aa/db'
import type { Clock } from './clock.js'

export const SESSION_COOKIE = 'aa_session'

/** FR-13.7 — customers stay signed in far longer than staff, who share terminals. */
export const CUSTOMER_SESSION_DAYS = 30
export const STAFF_SESSION_HOURS = 12

export type UserRole = 'customer' | 'chauffeur' | 'staff' | 'owner'

export interface SessionUser {
  readonly userId: string
  readonly role: UserRole
  readonly branchId: string | null
  readonly fullName: string
}

interface SessionDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function lifetimeMs(role: UserRole): number {
  return role === 'customer'
    ? CUSTOMER_SESSION_DAYS * 24 * 60 * 60_000
    : STAFF_SESSION_HOURS * 60 * 60_000
}

/**
 * NFR-3 — the cookie carries an opaque random token; the database stores only its
 * SHA-256. A leaked table therefore yields no usable session. Not a JWT: revocation
 * must be immediate, and a signed token cannot be withdrawn.
 *
 * A plain INSERT, not a check-then-write: nothing here reads a row and later
 * decides based on it, so there is no analogue of Task 5's unguarded-UPDATE race.
 * The only cross-request collision would be two callers generating the same
 * 32-byte random token, which `tokenHash`'s unique constraint would catch and is
 * astronomically improbable regardless.
 */
export async function createSession(
  deps: SessionDeps,
  input: { readonly userId: string; readonly role: UserRole; readonly ipAddress?: string; readonly userAgent?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(deps.clock().getTime() + lifetimeMs(input.role))
  await deps.db.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  })
  return { token, expiresAt }
}

/**
 * Returns null for unknown, expired, or deactivated-user sessions alike (FR-21.6).
 *
 * Read-only: resolving a session never writes anything, so there is nothing here
 * for a second concurrent caller to race against. Deactivation itself is a plain
 * `UPDATE users SET is_active = false ...` (outside this module) with no prior
 * read to go stale — the very next `resolveSession` call simply joins against the
 * fresh row and sees `isActive: false`.
 */
export async function resolveSession(
  deps: SessionDeps,
  token: string,
): Promise<SessionUser | null> {
  const now = deps.clock()
  const [row] = await deps.db
    .select({
      userId: users.id, role: users.role, branchId: users.branchId,
      fullName: users.fullName, isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1)

  if (row === undefined || !row.isActive) return null
  return {
    userId: row.userId, role: row.role as UserRole,
    branchId: row.branchId, fullName: row.fullName,
  }
}

/**
 * Deleting by `tokenHash` is idempotent, not a check-then-write: an unknown or
 * already-revoked token simply matches zero rows. Two concurrent revokes of the
 * same session both delete-or-no-op and leave the row gone either way — there is
 * no window in which one caller's decision is based on a read the other has since
 * invalidated.
 */
export async function revokeSession(deps: SessionDeps, token: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

/**
 * FR-21.6 — deactivating an account must end its sessions immediately.
 *
 * Same shape as `revokeSession`: a delete filtered on `userId`, not a
 * select-then-decide. A session created concurrently with this call either
 * commits before the delete (and is removed) or after (and simply survives to be
 * revoked by a subsequent call) — no interleaving lets a session "pass a check"
 * that has already been invalidated.
 */
export async function revokeAllForUser(deps: SessionDeps, userId: string): Promise<void> {
  await deps.db.delete(sessions).where(eq(sessions.userId, userId))
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // NFR-3 requires Secure in production. Over plain http://localhost a Secure cookie
    // is silently dropped by the browser, so local development could never stay signed
    // in. Conditional on the environment, never on a request header — a header is
    // attacker-controlled and would let anyone downgrade the cookie.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  }
}
