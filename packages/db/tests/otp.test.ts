import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDb } from './db.js'
import { phoneOtps } from '../src/schema/index.js'

const db = withTestDb()

describe('phone OTP schema', () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE phone_otps RESTART IDENTITY CASCADE`)
  })

  it('stores only a hash of the code, never the code itself', async () => {
    const [row] = await db.insert(phoneOtps).values({
      phone: '+971501234567',
      codeHash: 'sha256-of-the-code',
      expiresAt: new Date('2026-08-01T10:05:00Z'),
      ipAddress: '94.200.1.1',
    }).returning()
    expect(row!.attempts).toBe(0)
    expect(row!.consumedAt).toBeNull()
    const columns = Object.keys(row!)
    expect(columns).not.toContain('code')
  })

  it('rejects a negative attempt count', async () => {
    await expect(db.insert(phoneOtps).values({
      phone: '+971501234567', codeHash: 'x',
      expiresAt: new Date('2026-08-01T10:05:00Z'), attempts: -1,
    })).rejects.toThrow(/attempts_non_negative/)
  })

  it('indexes by phone so the sweeper and lookup do not scan', async () => {
    const r = await db.execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'phone_otps'`)
    const byName = new Map(r.rows.map((x) => [x.indexname, x.indexdef]))
    expect(byName.get('phone_otps_phone_idx')).toMatch(/\(phone, created_at\)/)
  })

  it('indexes by IP so per-IP rate limiting does not scan (FR-13.3)', async () => {
    const r = await db.execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'phone_otps'`)
    const byName = new Map(r.rows.map((x) => [x.indexname, x.indexdef]))
    expect(byName.get('phone_otps_ip_idx')).toMatch(/\(ip_address, created_at\)/)
  })

  it('allows several codes for one number, so a resend does not violate a constraint', async () => {
    const base = { phone: '+971509999999', codeHash: 'a', expiresAt: new Date('2026-08-01T10:05:00Z') }
    await db.insert(phoneOtps).values(base)
    await expect(db.insert(phoneOtps).values({ ...base, codeHash: 'b' })).resolves.toBeDefined()
  })
})
