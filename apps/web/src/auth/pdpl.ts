import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
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
 * a twist: there is no business invariant to violate (anonymising an already-active
 * row is always safe), so it cannot cause an incorrect *end state* the way an
 * unguarded double-booking could. What an unguarded write CAN cause is a wrong
 * *audit trail*: two callers racing the same request would both read the same
 * original `before`, both write, and both insert an audit row claiming to be the
 * transition from the original values — one of those entries would misrepresent
 * what was actually true at the moment it ran, and repeated (or double-submitted)
 * calls would each mint a fresh, redundant audit entry for an action that already
 * happened.
 *
 * So the UPDATE itself is the guard, not the earlier SELECT: `WHERE is_active =
 * true` is re-evaluated against the current committed row when a concurrent writer
 * is unblocked, exactly like Task 5's fix. Only the caller whose write actually
 * transitions the row from active to anonymised gets a matching row back and
 * proceeds to touch sessions/customers and write the single audit entry. A second
 * concurrent or later call finds nothing left to do and returns — a true no-op,
 * not just "didn't throw".
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

  // Guarded write: only rows still active are anonymised. A concurrent or repeat
  // call finds `is_active = false` already and this matches zero rows.
  const [updated] = await deps.db.update(users).set(after)
    .where(and(eq(users.id, input.userId), eq(users.isActive, true)))
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
    before: { phone: before.phone, email: before.email, fullName: before.fullName },
    after: { phone: after.phone, email: after.email, fullName: after.fullName },
    ipAddress: input.ipAddress ?? null,
  })
}
