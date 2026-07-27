import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.js'

const pools = new Set<pg.Pool>()

export function createDb(connectionString: string): NodePgDatabase<typeof schema> {
  const pool = new pg.Pool({ connectionString, max: 10 })
  pools.add(pool)
  return drizzle(pool, { schema })
}

/** Closes every pool this module created. Tests call this; production does not. */
export async function closeAllPools(): Promise<void> {
  const open = [...pools]
  pools.clear()
  await Promise.all(open.map((pool) => pool.end()))
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
