import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('monorepo workspace', () => {
  it('declares the packages and apps globs', () => {
    const ws = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    expect(ws).toContain('packages/*')
    expect(ws).toContain('apps/*')
  })

  it('pins Node 24', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.engines.node).toMatch(/^>=24/)
  })

  it('enables TypeScript strict mode with no implicit any', () => {
    const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8'))
    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true)
  })

  it('has a turbo pipeline covering typecheck, test and build', () => {
    expect(existsSync(join(root, 'turbo.json'))).toBe(true)
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'))
    for (const task of ['typecheck', 'test', 'build']) {
      expect(turbo.tasks[task]).toBeDefined()
    }
  })
})
