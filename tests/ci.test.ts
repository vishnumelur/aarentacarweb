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

  it('does not pin a pnpm version that conflicts with packageManager', () => {
    const workflow = ci()
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    const declared = String(pkg.packageManager ?? '').replace(/^pnpm@/, '')

    // Scope the search to just the pnpm/action-setup step's own block, stopping at
    // the next step. A naive scan-forward regex would also match `node-version:` in
    // the following actions/setup-node step, since "version:" is a substring of it.
    const lines = workflow.split('\n')
    const stepStart = lines.findIndex((l) => /pnpm\/action-setup@v\d/.test(l))
    expect(stepStart).toBeGreaterThanOrEqual(0)
    const block: string[] = []
    for (let i = stepStart + 1; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined || /^\s*-\s+(uses|run|name):/.test(line)) break
      block.push(line)
    }
    const pinned = block.join('\n').match(/version:\s*['"]?([\d.]+)/)?.[1]

    // Either the workflow pins nothing (packageManager wins), or it matches exactly.
    // pnpm/action-setup throws on any mismatch, failing the job before anything runs.
    if (pinned !== undefined) {
      expect(pinned).toBe(declared)
    }
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
