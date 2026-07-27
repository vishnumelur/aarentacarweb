import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb } from '../src/client.js'

describe('database client', () => {
  it('connects and reports Postgres 17 or later', async () => {
    const db = createDb(process.env.DATABASE_URL_TEST!)
    const result = await db.execute<{ version: string }>(sql`SHOW server_version`)
    const major = Number(String(result.rows[0]!.version).split('.')[0])
    expect(major).toBeGreaterThanOrEqual(17)
  })

  it('runs in UTC so timestamps are unambiguous', async () => {
    const db = createDb(process.env.DATABASE_URL_TEST!)
    const result = await db.execute<{ TimeZone: string }>(sql`SHOW timezone`)
    expect(result.rows[0]!.TimeZone).toBe('UTC')
  })
})
