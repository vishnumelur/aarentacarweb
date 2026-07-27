import net from 'node:net'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb, closeAllPools } from '../src/client.js'

const MIGRATIONS_FOLDER = './migrations'

let embedded: EmbeddedPostgres | undefined

function reachable(port: number, host = 'localhost'): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ port, host })
    const done = (result: boolean) => {
      socket.destroy()
      resolvePromise(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

/**
 * Uses the Postgres at DATABASE_URL_TEST when one is listening — Docker, a native
 * install, or CI's service container. Falls back to an embedded PostgreSQL 17 on the
 * same port when nothing is, so tests run on a machine without Docker.
 */
export async function setup(): Promise<() => Promise<void>> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) {
    // A throw inside globalSetup does not fail the vitest run — it prints an unhandled
    // error and exits 0, which let CI report success having run zero tests. Exit
    // explicitly so the failure is impossible to miss.
    console.error('FATAL: DATABASE_URL_TEST is not set — refusing to run with no database.')
    process.exit(1)
  }

  const parsed = new URL(url)
  const port = Number(parsed.port || '5432')

  if (!(await reachable(port))) {
    process.env.TZ = 'UTC'
    embedded = new EmbeddedPostgres({
      databaseDir: resolve('./.embedded-pg'),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      port,
      persistent: false,
      onLog: () => {},
      postgresFlags: ['-c', 'timezone=UTC', '-c', 'log_timezone=UTC'],
    })
    await embedded.initialise()
    await embedded.start()
    await embedded.createDatabase(parsed.pathname.slice(1))
  }

  // Tasks 4+ generate migrations; at Task 3 the folder is legitimately empty.
  if (existsSync(MIGRATIONS_FOLDER) && readdirSync(MIGRATIONS_FOLDER).some((f) => f.endsWith('.sql'))) {
    await migrate(createDb(url), { migrationsFolder: MIGRATIONS_FOLDER })
    // Close the migration pool now rather than holding it open for the whole run —
    // nothing else has called createDb() yet at this point in globalSetup.
    await closeAllPools()
  }

  return async () => {
    // Close every test file's pool before stopping the server: an idle client left
    // open when Postgres shuts down would otherwise emit an unhandled 'error' event.
    await closeAllPools()
    if (embedded) await embedded.stop()
  }
}
