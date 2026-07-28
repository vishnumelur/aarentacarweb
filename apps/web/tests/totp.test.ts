import { describe, it, expect } from 'vitest'
import { generateTotpSecret, totpUri, verifyTotp } from '../src/auth/totp.js'
import * as OTPAuth from 'otpauth'

function codeAt(secret: string, at: Date): string {
  return new OTPAuth.TOTP({
    issuer: 'AA Rentals', label: 'test',
    secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30,
  }).generate({ timestamp: at.getTime() })
}

describe('TOTP', () => {
  it('generates a base32 secret', () => {
    const s = generateTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]+$/)
    expect(s.length).toBeGreaterThanOrEqual(16)
  })

  it('generates different secrets each time', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })

  it('builds an otpauth URI an authenticator app can read', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'staff@aa-rentals.ae')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain('AA%20Rentals')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
  })

  it('accepts the code valid at that instant', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    expect(verifyTotp(secret, codeAt(secret, now), now)).toBe(true)
  })

  it('rejects a code from far in the past', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    const old = codeAt(secret, new Date('2026-08-01T09:00:00Z'))
    expect(verifyTotp(secret, old, now)).toBe(false)
  })

  it('tolerates one period of clock skew either side', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    const justBefore = codeAt(secret, new Date('2026-08-01T09:59:45Z'))
    const justAfter = codeAt(secret, new Date('2026-08-01T10:00:15Z'))
    expect(verifyTotp(secret, justBefore, now)).toBe(true)
    expect(verifyTotp(secret, justAfter, now)).toBe(true)
  })

  it('rejects a malformed token rather than throwing', () => {
    const secret = generateTotpSecret()
    const now = new Date('2026-08-01T10:00:00Z')
    expect(verifyTotp(secret, '', now)).toBe(false)
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false)
    expect(verifyTotp(secret, '12345678901234', now)).toBe(false)
  })
})
