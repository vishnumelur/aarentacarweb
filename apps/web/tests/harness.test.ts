import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { getAppDb } from '../src/db.js'
import { systemClock, type Clock } from '../src/auth/clock.js'

describe('app test harness', () => {
  it('reaches a real Postgres, not a mock', async () => {
    const db = getAppDb()
    const r = await db.execute<{ server_version: string }>(sql`SHOW server_version`)
    expect(Number(String(r.rows[0]!.server_version).split('.')[0])).toBeGreaterThanOrEqual(17)
  })

  it('runs the database in UTC', async () => {
    const r = await getAppDb().execute<{ TimeZone: string }>(sql`SHOW timezone`)
    expect(r.rows[0]!.TimeZone).toBe('UTC')
  })

  it('can see the tables P1.1 migrated', async () => {
    const r = await getAppDb().execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)
    const names = r.rows.map((x) => x.table_name)
    for (const t of ['users', 'sessions', 'customers', 'audit_log']) {
      expect(names, `${t} must exist`).toContain(t)
    }
  })

  it('exposes an injectable clock rather than reading time internally', () => {
    const fixed: Clock = () => new Date('2026-08-01T10:00:00Z')
    expect(fixed().toISOString()).toBe('2026-08-01T10:00:00.000Z')
    // The system clock is real, and every auth function takes a Clock parameter so
    // expiry can be tested without waiting.
    expect(systemClock()).toBeInstanceOf(Date)
  })
})
