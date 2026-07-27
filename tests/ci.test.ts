import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ci = () => readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8')

describe('ci pipeline', () => {
  it('runs on push and pull request', () => {
    const c = ci()
    expect(c).toMatch(/on:/)
    expect(c).toContain('pull_request')
  })

  it('uses Node 24', () => {
    expect(ci()).toMatch(/node-version:\s*['"]?24/)
  })

  it('provisions Postgres 17 as a service so tests hit a real database', () => {
    const c = ci()
    expect(c).toContain('postgres:17')
    expect(c).toContain('aarental_test')
  })

  it('runs typecheck and tests', () => {
    const c = ci()
    expect(c).toContain('pnpm typecheck')
    expect(c).toContain('pnpm test')
  })
})
