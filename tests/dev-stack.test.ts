import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const compose = () => readFileSync(join(root, 'docker-compose.dev.yml'), 'utf8')
const envExample = () => readFileSync(join(root, '.env.example'), 'utf8')

describe('local development stack', () => {
  it('pins the same major versions as production', () => {
    const c = compose()
    expect(c).toContain('postgres:17')
    expect(c).toContain('redis:7')
    expect(c).toContain('minio/minio')
  })

  it('creates a separate test database so tests never touch dev data', () => {
    expect(compose()).toContain('aarental_test')
  })

  it('runs Postgres in UTC', () => {
    expect(compose()).toContain('TZ: UTC')
  })

  it('documents every required variable with no values', () => {
    const e = envExample()
    const required = [
      'DATABASE_URL', 'DATABASE_URL_TEST', 'REDIS_URL',
      'S3_ENDPOINT', 'S3_PUBLIC_URL', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
      'S3_BUCKET_KYC', 'S3_BUCKET_INSPECTIONS', 'S3_BUCKET_CONTRACTS', 'S3_BUCKET_VEHICLES',
      'SESSION_SECRET', 'NOTIFY_DRIVER', 'TZ',
    ]
    for (const key of required) {
      expect(e, `missing ${key}`).toMatch(new RegExp(`^${key}=`, 'm'))
    }
  })

  it('uses the console notification driver locally so tests never message real phones', () => {
    expect(envExample()).toMatch(/^NOTIFY_DRIVER=console$/m)
  })
})
