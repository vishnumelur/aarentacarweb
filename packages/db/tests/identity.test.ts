import { describe, it, expect, beforeEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { users, customers, customerDocuments } from '../src/schema/index.js'
import { withTestDb } from './db.js'

const db = withTestDb()

describe('identity and customer schema', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE customer_documents, customers, users RESTART IDENTITY CASCADE`)
  })

  it('stores a user with a role and a unique phone', async () => {
    const [user] = await db.insert(users)
      .values({ phone: '+971503377877', role: 'staff', fullName: 'Counter Staff' })
      .returning()
    expect(user!.role).toBe('staff')
    expect(user!.isActive).toBe(true)
  })

  it('rejects a duplicate phone number', async () => {
    await db.insert(users).values({ phone: '+971501111111', role: 'customer', fullName: 'A' })
    await expect(
      db.insert(users).values({ phone: '+971501111111', role: 'customer', fullName: 'B' }),
    ).rejects.toThrow()
  })

  it('defaults a customer to not blacklisted and requires a reason when blacklisting', async () => {
    const [user] = await db.insert(users)
      .values({ phone: '+971502222222', role: 'customer', fullName: 'Tourist' }).returning()
    const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
    expect(customer!.isBlacklisted).toBe(false)

    await expect(
      db.update(customers).set({ isBlacklisted: true }).where(eq(customers.id, customer!.id)),
    ).rejects.toThrow()
  })

  it('accepts a blacklist with a reason', async () => {
    const [user] = await db.insert(users)
      .values({ phone: '+971503333333', role: 'customer', fullName: 'Tourist' }).returning()
    const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
    const [updated] = await db.update(customers)
      .set({ isBlacklisted: true, blacklistReason: 'Repeated non-payment' })
      .where(eq(customers.id, customer!.id)).returning()
    expect(updated!.isBlacklisted).toBe(true)
  })

  it('stores a KYC document with an expiry and a pending status', async () => {
    const [user] = await db.insert(users)
      .values({ phone: '+971504444444', role: 'customer', fullName: 'Resident' }).returning()
    const [customer] = await db.insert(customers).values({ userId: user!.id }).returning()
    const [doc] = await db.insert(customerDocuments).values({
      customerId: customer!.id,
      type: 'emirates_id',
      documentNumber: '784-1990-1234567-1',
      expiresOn: '2030-01-01',
      objectKey: 'aa-kyc/abc123.jpg',
    }).returning()
    expect(doc!.status).toBe('pending')
  })
})
