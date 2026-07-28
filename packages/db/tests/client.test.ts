import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { withTestDb } from './db.js'

describe('database client', () => {
  it('connects and reports Postgres 17 or later', async () => {
    const db = withTestDb()
    // `SHOW server_version` names its column `server_version`, not `version`.
    const result = await db.execute<{ server_version: string }>(sql`SHOW server_version`)
    const major = Number(String(result.rows[0]!.server_version).split('.')[0])
    expect(major).toBeGreaterThanOrEqual(17)
  })

  it('runs in UTC so timestamps are unambiguous', async () => {
    const db = withTestDb()
    const result = await db.execute<{ TimeZone: string }>(sql`SHOW timezone`)
    expect(result.rows[0]!.TimeZone).toBe('UTC')
  })
})
