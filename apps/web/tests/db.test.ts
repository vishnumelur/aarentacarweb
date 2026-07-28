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
  const originalUrl = process.env.DATABASE_URL

  // Restores every variable a test might have touched to its exact original state —
  // `delete` for keys that were absent, an assignment for keys that had a value.
  // Assigning `undefined` directly would coerce to the string "undefined" rather
  // than clearing the key, silently leaking state into whichever test runs next.
  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  afterEach(() => {
    restore('NODE_ENV', originalNodeEnv)
    restore('VITEST', originalVitest)
    restore('DATABASE_URL_TEST', originalTestUrl)
    restore('DATABASE_URL', originalUrl)
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

  it('refuses production even when a test-harness variable has leaked in', () => {
    // NODE_ENV=production with a stray VITEST=true must not take the test branch —
    // the production refusal has to be checked first and unconditionally, or a
    // leaked CI/base-image variable bypasses it entirely.
    process.env.NODE_ENV = 'production'
    process.env.VITEST = 'true'
    process.env.DATABASE_URL_TEST = 'postgresql://x@localhost:5432/test'
    process.env.DATABASE_URL = 'postgresql://x@localhost:5432/prod'

    expect(() => connectionString()).toThrow(/production/i)
  })
})
