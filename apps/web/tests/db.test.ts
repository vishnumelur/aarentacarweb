import { describe, it, expect, afterEach } from 'vitest'
import { connectionString } from '../src/db.js'

/**
 * `connectionString()` is the only place `DATABASE_URL_TEST` takes precedence over
 * `DATABASE_URL`. `packages/db`'s own `getDb()` reads only `DATABASE_URL`, so this
 * precedence — and its guard against leaking into production — is new here and
 * worth proving directly, without going through `getAppDb()`'s cache or attempting a
 * real connection for the branch that must refuse to connect at all.
 */
describe('connectionString', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalVitest = process.env.VITEST
  const originalTestUrl = process.env.DATABASE_URL_TEST

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    process.env.VITEST = originalVitest
    process.env.DATABASE_URL_TEST = originalTestUrl
  })

  it('chooses DATABASE_URL_TEST under vitest', () => {
    // These are vitest's own ambient variables, not ones this test fabricates —
    // confirmed present (VITEST=true, NODE_ENV=test) by probing this exact harness
    // before writing the guard.
    expect(process.env.VITEST).toBe('true')
    expect(process.env.DATABASE_URL_TEST).toBeDefined()
    expect(connectionString()).toBe(process.env.DATABASE_URL_TEST)
  })

  it('refuses to start rather than silently connect when DATABASE_URL_TEST leaks into production', () => {
    // Simulate a production process that still carries a stray DATABASE_URL_TEST —
    // the exact scenario the guard exists for. VITEST must be cleared too, or the
    // "are we under the test harness" check alone would make this pass for the wrong
    // reason.
    process.env.NODE_ENV = 'production'
    delete process.env.VITEST
    process.env.DATABASE_URL_TEST = 'postgres://fake-test-db:5432/should_never_be_used'

    expect(() => connectionString()).toThrow(/DATABASE_URL_TEST is set in a production environment/)
  })
})
