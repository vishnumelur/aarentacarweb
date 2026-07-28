import { resolve } from 'node:path'
import { config } from 'dotenv'

config({ path: resolve(import.meta.dirname, '../../../.env') })

/**
 * The app's tests run against whatever Postgres `DATABASE_URL_TEST` names. In
 * development that is the Docker container; in CI it is the service container.
 * `packages/db`'s own globalSetup already applies migrations, so this file only
 * asserts the database is reachable — a missing database must fail loudly rather
 * than let a suite report success having tested nothing.
 */
export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) {
    console.error('FATAL: DATABASE_URL_TEST is not set — refusing to run with no database.')
    process.exit(1)
  }
  const net = await import('node:net')
  const port = Number(new URL(url).port || '5432')
  const reachable = await new Promise<boolean>((res) => {
    const s = net.connect({ port, host: 'localhost' })
    const done = (v: boolean) => { s.destroy(); res(v) }
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
    s.setTimeout(1000, () => done(false))
  })
  if (!reachable) {
    console.error(`FATAL: nothing listening on localhost:${port}. Start the dev stack:`)
    console.error('  docker compose -f docker-compose.dev.yml up -d')
    process.exit(1)
  }
}
