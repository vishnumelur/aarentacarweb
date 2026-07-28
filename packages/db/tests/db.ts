import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { createDb } from '../src/client.js'
import * as schema from '../src/schema/index.js'

let cached: NodePgDatabase<typeof schema> | undefined

/**
 * The shared test database handle. One pool per test file rather than one per call.
 * Tasks 4-11 use this instead of calling createDb directly.
 */
export function withTestDb(): NodePgDatabase<typeof schema> {
  if (!cached) {
    const url = process.env.DATABASE_URL_TEST
    if (!url) throw new Error('DATABASE_URL_TEST is not set')
    cached = createDb(url)
  }
  return cached
}
