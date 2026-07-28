import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../src/auth/password.js'

describe('password hashing', () => {
  it('produces an Argon2id hash, not bcrypt or a bare digest', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword(hash, 's3cret-passphrase')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword(hash, 's3cret-passphras')).toBe(false)
    expect(await verifyPassword(hash, '')).toBe(false)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same-password')).toBe(true)
    expect(await verifyPassword(b, 'same-password')).toBe(true)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })
})
