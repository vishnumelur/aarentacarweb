import { randomUUID } from 'node:crypto'
import { and, eq, notLike } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { schema, users, customers, auditLog, sessions } from '@aa/db'
import type { Clock } from './clock.js'

interface PdplDeps {
  readonly db: NodePgDatabase<typeof schema>
  readonly clock: Clock
}

export interface PersonalDataExport {
  readonly exportedAt: string
  readonly user: Record<string, unknown>
  readonly customer: Record<string, unknown> | null
}

/**
 * FR-13.8 — a customer may obtain everything held about them.
 *
 * `passwordHash` and `totpSecret` are credentials, not personal data the customer
 * is owed a copy of, and must never appear in an export handed back to them.
 */
export async function exportPersonalData(
  deps: PdplDeps, userId: string,
): Promise<PersonalDataExport> {
  const [user] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (user === undefined) throw new Error(`No such user: ${userId}`)
  const [customer] = await deps.db.select().from(customers)
    .where(eq(customers.userId, userId)).limit(1)

  const { passwordHash: _passwordHash, totpSecret: _totpSecret, ...safeUser } = user

  return {
    exportedAt: deps.clock().toISOString(),
    user: safeUser,
    customer: customer ?? null,
  }
}

/**
 * FR-13.8, NFR-12 — deletion anonymises rather than removes.
 *
 * Invoices, signed rental agreements and handover records reference this row and must
 * be retained for five years under UAE tax law, so the row survives with its
 * identifying fields replaced by values that cannot be reversed. Sessions are revoked
 * and the account deactivated. The row is never deleted.
 *
 * This is the Task 5 race shape — read a row, decide from it, write unguarded — with
 * a twist: there is no business invariant to violate (anonymising an already-
 * anonymised row is always safe), so it cannot cause an incorrect *end state* the
 * way an unguarded double-booking could. What an unguarded write CAN cause is a
 * wrong *audit trail*: two callers racing the same request would both read the
 * same original `before`, both write, and both insert an audit row claiming to be
 * the transition from the original values, and repeated (or double-submitted)
 * calls would each mint a fresh, redundant audit entry for an action that already
 * happened.
 *
 * So the UPDATE itself is the guard, not the earlier SELECT — but it must be keyed
 * on whether the row has *already been anonymised*, not on `isActive`. `isActive`
 * is the general account-enabled flag (see `session.ts`'s `revokeAllForUser` and
 * the separate deactivation path it documents); a suspended or staff-offboarded
 * user is `isActive: false` while still holding real PII, and keying the guard on
 * that flag would make an erasure request against such an account silently no-op —
 * no scrub, no revoke, no audit entry, no error. The guard instead checks the
 * anonymisation marker itself (the `anonymised-` phone prefix), which is
 * re-evaluated against the current committed row when a concurrent writer is
 * unblocked, exactly like Task 5's fix. Only the caller whose write actually
 * transitions the row gets a matching row back and proceeds to touch
 * sessions/customers and write the single audit entry. A second concurrent or
 * later call finds nothing left to do and returns — a true no-op, not just
 * "didn't throw".
 */
export async function anonymiseUser(
  deps: PdplDeps,
  input: { readonly userId: string; readonly actorUserId: string; readonly ipAddress?: string },
): Promise<void> {
  const [before] = await deps.db.select().from(users)
    .where(eq(users.id, input.userId)).limit(1)
  if (before === undefined) return

  const marker = randomUUID()
  const after = {
    phone: `anonymised-${marker}`,
    email: null,
    fullName: 'Anonymised',
    passwordHash: null,
    totpSecret: null,
    isActive: false,
  }

  // Guarded write: only rows not yet anonymised are touched. NOT keyed on
  // `isActive` — that is the account-enabled flag, not an anonymisation marker,
  // and a suspended or offboarded (isActive: false) user still holds real PII
  // that must remain erasable. A concurrent or repeat call finds the
  // `anonymised-` phone prefix already in place and this matches zero rows.
  const [updated] = await deps.db.update(users).set(after)
    .where(and(eq(users.id, input.userId), notLike(users.phone, 'anonymised-%')))
    .returning()
  if (updated === undefined) return

  await deps.db.delete(sessions).where(eq(sessions.userId, input.userId))
  await deps.db.update(customers)
    .set({ nationality: null, dateOfBirth: null, internalNotes: null })
    .where(eq(customers.userId, input.userId))

  await deps.db.insert(auditLog).values({
    actorUserId: input.actorUserId,
    entityType: 'users',
    entityId: input.userId,
    action: 'anonymise',
    // FR-11.3 needs the fact and the actor; FR-13.8 forbids retaining the erased
    // values. `auditLog` is immutable with no update/delete path, so storing the
    // originals here would make it a permanent, unerasable backdoor to the very
    // data the customer asked to have erased.
    before: { phone: '[redacted]', email: '[redacted]', fullName: '[redacted]' },
    after: { phone: after.phone, email: after.email, fullName: after.fullName },
    ipAddress: input.ipAddress ?? null,
  })
}
