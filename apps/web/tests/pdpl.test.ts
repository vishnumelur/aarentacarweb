import { describe, it, expect, beforeEach } from 'vitest'
import { sql, eq } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { users, customers, auditLog } from '@aa/db'
import { exportPersonalData, anonymiseUser } from '../src/auth/pdpl.js'
import type { Clock } from '../src/auth/clock.js'

const db = getAppDb()
const clock: Clock = () => new Date('2026-08-01T10:00:00Z')

async function aCustomer(phone: string) {
  const [u] = await db.insert(users)
    .values({ phone, email: `${phone}@example.com`, fullName: 'Aisha Khan', role: 'customer' })
    .returning()
  await db.insert(customers).values({ userId: u!.id, nationality: 'AE' })
  return u!
}

describe('PDPL export and anonymise (FR-13.8)', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE audit_log, sessions, customers, users RESTART IDENTITY CASCADE`)
  })

  it('exports every personal field held about the customer', async () => {
    const u = await aCustomer('+971501111111')
    const data = await exportPersonalData({ db, clock }, u.id)
    expect(data.user.phone).toBe('+971501111111')
    expect(data.user.fullName).toBe('Aisha Khan')
    expect(data.customer?.nationality).toBe('AE')
  })

  it('anonymises rather than deleting, so financial records survive', async () => {
    const u = await aCustomer('+971502222222')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })

    const [after] = await db.select().from(users).where(eq(users.id, u.id))
    // The row must still exist — invoices and contracts reference it.
    expect(after).toBeDefined()
    expect(after!.fullName).not.toBe('Aisha Khan')
    expect(after!.email).toBeNull()
    expect(after!.phone).not.toBe('+971502222222')
    expect(after!.isActive).toBe(false)
  })

  it('writes an audit entry naming the actor (FR-11.3), with the erased values redacted', async () => {
    const u = await aCustomer('+971503333333')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]!.action).toBe('anonymise')
    expect(entries[0]!.actorUserId).toBe(u.id)
    // FR-13.8: the audit log is immutable with no update/delete path, so it must
    // not become a permanent backdoor to the values the customer asked erased.
    expect(entries[0]!.before).toEqual({ phone: '[redacted]', email: '[redacted]', fullName: '[redacted]' })
    expect(entries[0]!.after).toMatchObject({ email: null, fullName: 'Anonymised' })
    expect(JSON.stringify(entries[0])).not.toContain('+971503333333')
  })

  it('erases a suspended (isActive: false) account rather than silently no-oping', async () => {
    const u = await aCustomer('+971506666666')
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.id))

    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })

    const [after] = await db.select().from(users).where(eq(users.id, u.id))
    expect(after!.phone).not.toBe('+971506666666')
    expect(after!.email).toBeNull()
    expect(after!.fullName).not.toBe('Aisha Khan')

    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id))
    expect(entries).toHaveLength(1)
  })

  it('does not write a second audit row when anonymising an already-anonymised account', async () => {
    const u = await aCustomer('+971507777777')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })

    const entries = await db.select().from(auditLog).where(eq(auditLog.entityId, u.id))
    expect(entries).toHaveLength(1)
  })

  it('leaves no way to recover the original phone from the anonymised row', async () => {
    const u = await aCustomer('+971504444444')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    const [after] = await db.select().from(users).where(eq(users.id, u.id))
    expect(JSON.stringify(after)).not.toContain('+971504444444')
  })

  it('is idempotent — anonymising twice does not throw or double-audit differently', async () => {
    const u = await aCustomer('+971505555555')
    await anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })
    await expect(anonymiseUser({ db, clock }, { userId: u.id, actorUserId: u.id })).resolves.toBeUndefined()
  })
})
