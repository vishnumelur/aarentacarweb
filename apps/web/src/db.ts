import { createDb, schema } from '@aa/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/**
 * Chooses the connection string, refusing to let a stray `DATABASE_URL_TEST` in a
 * production environment serve real customers from test data.
 *
 * `packages/db`'s own `getDb()` reads only `DATABASE_URL` — this file is the only
 * place `DATABASE_URL_TEST` precedence exists, so it is guarded explicitly: honoured
 * only when the process is genuinely running under the test harness (vitest sets
 * both `VITEST=true` and `NODE_ENV=test`), and treated as a fatal misconfiguration
 * — not silently ignored — if found alongside `NODE_ENV=production`.
 *
 * Exported so tests can exercise both branches directly without going through
 * `getAppDb()`'s cache, and without attempting a real connection for the branch that
 * is supposed to refuse to connect at all.
 */
export function connectionString(): string {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  if (isTest) {
    const testUrl = process.env.DATABASE_URL_TEST
    if (testUrl === undefined) throw new Error('DATABASE_URL_TEST is not set')
    return testUrl
  }
  if (process.env.DATABASE_URL_TEST !== undefined && process.env.NODE_ENV === 'production') {
    // Loud, not silent: serving customers from the test database is worse than not
    // starting at all.
    throw new Error(
      'DATABASE_URL_TEST is set in a production environment. Refusing to start — ' +
        'remove it, or the app may serve real customers from test data.',
    )
  }
  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL is not set')
  return url
}

// Cached on globalThis rather than at module scope: Next.js Fast Refresh re-evaluates
// modules on every edit in dev, and a module-scope `let` would open a fresh pg.Pool
// each time while the previous one's sockets stayed open, walking the connection
// limit over a dev session.
const globalForDb = globalThis as unknown as { __aaDb?: NodePgDatabase<typeof schema> }

/**
 * The application's database handle. Tests point at DATABASE_URL_TEST; the running
 * app points at DATABASE_URL.
 */
export function getAppDb(): NodePgDatabase<typeof schema> {
  globalForDb.__aaDb ??= createDb(connectionString())
  return globalForDb.__aaDb
}
