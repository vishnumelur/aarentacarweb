import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.js'

export function createDb(connectionString: string): NodePgDatabase<typeof schema> {
  const pool = new pg.Pool({ connectionString, max: 10 })
  return drizzle(pool, { schema })
}

let singleton: NodePgDatabase<typeof schema> | undefined

export function getDb(): NodePgDatabase<typeof schema> {
  if (!singleton) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    singleton = createDb(url)
  }
  return singleton
}
