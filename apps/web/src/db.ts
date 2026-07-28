import { createDb } from '@aa/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@aa/db/src/schema/index.js'

let cached: NodePgDatabase<typeof schema> | undefined

/**
 * The application's database handle. Tests point at DATABASE_URL_TEST; the running
 * app points at DATABASE_URL.
 */
export function getAppDb(): NodePgDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL
    if (!url) throw new Error('Neither DATABASE_URL_TEST nor DATABASE_URL is set')
    cached = createDb(url)
  }
  return cached
}
